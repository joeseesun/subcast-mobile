//! Streaming chat with the user's own model service: OpenAI-compatible `/chat/completions` (DeepSeek, SiliconFlow,
//! OpenRouter, Ollama, OpenAI, Kimi…) or Anthropic's Messages API. Keys: see the key store below.
use crate::net;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
const KEYRING_SERVICE: &str = "ai.qiaomu.subcast";

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub protocol: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    pub content: String,
}

// ---- key store ----------------------------------------------------------------------------------------
// iOS: the system Keychain. Android: a JSON file in the app's private data directory (only this app can read it;
// Android has no keychain reachable from Rust without a Java bridge). Desktop builds (for `cargo test`) use the file.

static KEY_FILE: once_cell::sync::OnceCell<std::path::PathBuf> = once_cell::sync::OnceCell::new();
static KEY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Where the file store lives; called once at startup.
pub fn init_store(data: &std::path::Path) { let _ = KEY_FILE.set(data.join("keys.json")); }

#[cfg(target_os = "ios")]
pub fn set_key(provider: &str, key: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider)?;
    if key.is_empty() { let _ = entry.delete_credential(); } else { entry.set_password(key)?; }
    Ok(())
}

#[cfg(target_os = "ios")]
pub fn get_key(provider: &str) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, provider).ok()?.get_password().ok()
}

#[cfg(not(target_os = "ios"))]
fn read_keys() -> serde_json::Map<String, Value> {
    KEY_FILE.get().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

#[cfg(not(target_os = "ios"))]
pub fn set_key(provider: &str, key: &str) -> Result<()> {
    let _g = KEY_LOCK.lock().unwrap();
    let file = KEY_FILE.get().ok_or_else(|| anyhow!("密钥存储还没准备好"))?;
    let mut keys = read_keys();
    if key.is_empty() { keys.remove(provider); } else { keys.insert(provider.to_string(), Value::String(key.to_string())); }
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(&keys)?)?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)); }
    std::fs::rename(&tmp, file)?;
    Ok(())
}

#[cfg(not(target_os = "ios"))]
pub fn get_key(provider: &str) -> Option<String> {
    let _g = KEY_LOCK.lock().unwrap();
    read_keys().get(provider).and_then(|v| v.as_str()).map(str::to_string)
}

/// OpenCode Go/Zen refuses requests without this header (it drives prompt-cache routing).
/// Any stable value passes; a per-install id gives the best cache affinity.
fn opencode_session() -> &'static str {
    static ID: once_cell::sync::Lazy<String> = once_cell::sync::Lazy::new(|| {
        if let Some(v) = get_key("opencode-session").filter(|v| !v.is_empty()) { return v; }
        let v = uuid::Uuid::new_v4().to_string();
        let _ = set_key("opencode-session", &v);
        v
    });
    &ID
}

fn needs_opencode_session(base_url: &str) -> bool { base_url.contains("opencode.ai") }

fn openai_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") { b.to_string() } else { format!("{b}/chat/completions") }
}

fn anthropic_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    let b = if b.is_empty() { "https://api.anthropic.com" } else { b };
    if b.ends_with("/messages") { b.to_string() } else if b.ends_with("/v1") { format!("{b}/messages") } else { format!("{b}/v1/messages") }
}

fn api_error(status: u16, body: &str) -> anyhow::Error {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().or_else(|| v["error"].as_str()).or_else(|| v["message"].as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(200).collect());
    match status {
        401 | 403 => anyhow!("API Key 无效或没有权限：{msg}"),
        404 => anyhow!("模型或地址不存在：{msg}"),
        429 => anyhow!("请求太频繁或额度不足：{msg}"),
        _ => anyhow!("模型服务出错（{status}）：{msg}"),
    }
}

/// Streams one reply; `on_delta` gets each piece of text. Returns the whole text.
/// Copes with what different providers and models do: newer reasoning models that refuse `max_tokens`
/// (retried with `max_completion_tokens`), models without JSON mode (retried without it), replies sent as one
/// JSON body instead of a stream, content given as an array of parts, and thinking that arrives separately or
/// inline as <think>…</think> (never shown; reported if it was all that came).
pub async fn chat(p: &Provider, system: &str, messages: &[Message], max_tokens: u32, json_mode: bool, cancel: &AtomicBool, mut on_delta: impl FnMut(&str)) -> Result<String> {
    let key = get_key(&p.id);
    let anthropic = p.protocol == "anthropic";
    if anthropic && key.is_none() { return Err(anyhow!("请先在设置里填写 API Key")); }
    let (mut completion_tokens, mut json) = (false, json_mode);
    let mut tries = 0;
    let res = loop {
        tries += 1;
        let req = if anthropic {
            let msgs: Vec<Value> = messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect();
            net::client()
                .post(anthropic_url(&p.base_url))
                .header("x-api-key", key.clone().unwrap_or_default())
                .header("anthropic-version", "2023-06-01")
                .json(&json!({ "model": p.model, "max_tokens": max_tokens, "system": system, "messages": msgs, "stream": true }))
        } else {
            let mut msgs = vec![json!({"role": "system", "content": system})];
            msgs.extend(messages.iter().map(|m| json!({"role": m.role, "content": m.content})));
            let mut body = json!({ "model": p.model, "messages": msgs, "stream": true });
            body[if completion_tokens { "max_completion_tokens" } else { "max_tokens" }] = json!(max_tokens);
            if json { body["response_format"] = json!({"type": "json_object"}); }
            let mut r = net::client().post(openai_url(&p.base_url)).json(&body);
            if needs_opencode_session(&p.base_url) { r = r.header("x-opencode-session", opencode_session()); }
            if let Some(k) = key.as_ref().filter(|k| !k.is_empty()) { r = r.bearer_auth(k); }
            r
        };
        let res = req.send().await.map_err(|e| anyhow!("连不上模型服务：{e}"))?;
        let status = res.status();
        if status.is_success() { break res; }
        let body = res.text().await.unwrap_or_default();
        let l = body.to_lowercase();
        if !anthropic && status.as_u16() == 400 && tries < 3 {
            if !completion_tokens && l.contains("max_completion_tokens") { completion_tokens = true; continue; }
            if json && (l.contains("response_format") || l.contains("json_object") || l.contains("json mode")) { json = false; continue; }
        }
        return Err(api_error(status.as_u16(), &body));
    };
    let mut stream = res.bytes_stream();
    let mut lines = LineBuf::default();
    let mut full = String::new();
    let mut think = ThinkFilter::default();
    let (mut thought, mut cut, mut streamed) = (false, false, false);
    let mut raw = String::new();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) { return Err(anyhow!("已停止")); }
        lines.push(&chunk.map_err(|e| anyhow!("连接中断：{e}"))?);
        while let Some(line) = lines.next_line() {
            let line = line.trim().to_string();
            let Some(data) = line.strip_prefix("data:") else { if !streamed && raw.len() < 4_000_000 { raw.push_str(&line); raw.push('\n'); } continue };
            streamed = true;
            let data = data.trim();
            if data == "[DONE]" { return finish(full, thought || think.saw, cut); }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            let piece = if anthropic {
                if v["delta"]["thinking"].is_string() { thought = true; }
                if v["delta"]["stop_reason"].as_str() == Some("max_tokens") { cut = true; }
                match v["type"].as_str() {
                    Some("content_block_delta") => v["delta"]["text"].as_str().map(String::from),
                    Some("error") => return Err(anyhow!("模型服务出错：{}", v["error"]["message"].as_str().unwrap_or("未知错误"))),
                    _ => None,
                }
            } else {
                if let Some(e) = v["error"]["message"].as_str() { return Err(anyhow!("模型服务出错：{e}")); }
                let d = &v["choices"][0]["delta"];
                if d["reasoning_content"].as_str().is_some_and(|x| !x.is_empty()) || d["reasoning"].as_str().is_some_and(|x| !x.is_empty()) { thought = true; }
                if v["choices"][0]["finish_reason"].as_str() == Some("length") { cut = true; }
                text_of(&d["content"])
            };
            if let Some(piece) = piece.map(|x| think.feed(&x)).filter(|p| !p.is_empty()) {
                full.push_str(&piece);
                on_delta(&piece);
            }
        }
    }
    // Not a stream after all: one JSON body (OpenAI-style message or Anthropic content blocks).
    if !streamed {
        let rest = lines.rest();
        let v: Value = serde_json::from_str(format!("{raw}{rest}").trim()).unwrap_or(Value::Null);
        if let Some(e) = v["error"]["message"].as_str() { return Err(anyhow!("模型服务出错：{e}")); }
        let msg = &v["choices"][0]["message"];
        if msg["reasoning_content"].is_string() || msg["reasoning"].is_string() { thought = true; }
        if v["choices"][0]["finish_reason"].as_str() == Some("length") || v["stop_reason"].as_str() == Some("max_tokens") { cut = true; }
        let text = text_of(&msg["content"]).or_else(|| text_of(&v["content"])).unwrap_or_default();
        let text = think.feed(&text);
        if !text.is_empty() { on_delta(&text); full.push_str(&text); }
    }
    finish(full, thought || think.saw, cut)
}

/// Message content as text: a string, or an array of parts ({type:"text", text}).
fn text_of(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() { return Some(s.to_string()); }
    let parts = v.as_array()?;
    Some(parts.iter().filter(|x| x["type"].as_str().is_none_or(|t| t == "text" || t == "output_text")).filter_map(|x| x["text"].as_str()).collect())
}

fn finish(full: String, thought: bool, cut: bool) -> Result<String> {
    if !full.trim().is_empty() { return Ok(full.trim_start().to_string()); }
    if thought || cut { return Err(anyhow!("模型把篇幅都用在了思考上，没有写出正文。请重试，或换一个不带深度思考的模型")); }
    Err(anyhow!("模型没有返回内容"))
}

/// Drops <think>…</think> (some models and relays put their reasoning in the content) across stream pieces.
#[derive(Default)]
struct ThinkFilter { inside: bool, pending: String, saw: bool }

impl ThinkFilter {
    fn feed(&mut self, piece: &str) -> String {
        let mut s = std::mem::take(&mut self.pending) + piece;
        let mut out = String::new();
        loop {
            let tag = if self.inside { "</think>" } else { "<think>" };
            if let Some(i) = s.find(tag) {
                if !self.inside { out.push_str(&s[..i]); }
                self.inside = !self.inside;
                if self.inside { self.saw = true; }
                s = s[i + tag.len()..].to_string();
                continue;
            }
            // Keep a possible partial tag for the next piece.
            let keep = (1..tag.len()).rev().find(|&n| s.len() >= n && s.is_char_boundary(s.len() - n) && tag.starts_with(&s[s.len() - n..])).unwrap_or(0);
            let (now, later) = s.split_at(s.len() - keep);
            if !self.inside { out.push_str(now); }
            self.pending = later.to_string();
            return out;
        }
    }
}

/// Bytes from a stream, handed out as whole lines. Decoding per network chunk would split a Chinese
/// character (3 bytes in UTF-8) that straddles two chunks into "��"; a line is only decoded once complete.
#[derive(Default)]
struct LineBuf { bytes: Vec<u8> }

impl LineBuf {
    fn push(&mut self, chunk: &[u8]) { self.bytes.extend_from_slice(chunk); }
    fn next_line(&mut self) -> Option<String> {
        let pos = self.bytes.iter().position(|&b| b == b'\n')?;
        let line: Vec<u8> = self.bytes.drain(..=pos).collect();
        Some(String::from_utf8_lossy(&line[..pos]).into_owned())
    }
    /// What's left without a final newline.
    fn rest(&mut self) -> String { String::from_utf8_lossy(&std::mem::take(&mut self.bytes)).into_owned() }
}

#[cfg(test)]
mod line_buf_tests {
    use super::LineBuf;
    #[test]
    fn a_character_split_across_chunks_stays_whole() {
        let text = "data: 黄仁勋能\n\ndata: [DONE]\n".as_bytes();
        let mut b = LineBuf::default();
        let mut got = Vec::new();
        // Split inside 仁 (bytes 9..12) and again inside 勋.
        for part in [&text[..10], &text[10..14], &text[14..]] {
            b.push(part);
            while let Some(l) = b.next_line() { got.push(l); }
        }
        assert_eq!(got, ["data: 黄仁勋能", "", "data: [DONE]"]);
        assert!(!got.concat().contains('\u{FFFD}'));
    }
}

#[cfg(test)]
mod reply_tests {
    use super::*;
    #[test]
    fn think_tags_are_dropped_across_pieces() {
        let mut f = ThinkFilter::default();
        let out: String = ["<thi", "nk>let me see</th", "ink>\n答案", "是 <b>42</b>"].iter().map(|p| f.feed(p)).collect();
        assert_eq!(out, "\n答案是 <b>42</b>");
        assert!(f.saw);
        let mut g = ThinkFilter::default();
        assert_eq!(g.feed("a < b"), "a < b");
        assert_eq!(g.feed(" x <"), " x ");
        assert_eq!(g.feed(" ok"), "< ok");
    }
    #[test]
    fn content_as_parts_and_empty_answers() {
        assert_eq!(text_of(&json!([{ "type": "text", "text": "你" }, { "type": "image_url" }, { "text": "好" }])).unwrap(), "你好");
        assert!(finish(String::new(), true, false).unwrap_err().to_string().contains("思考"));
        assert_eq!(finish("  \n答".into(), false, false).unwrap(), "答");
    }
}
