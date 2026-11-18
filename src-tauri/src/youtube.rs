//! YouTube captions without the viewer's cookies: ask InnerTube's player endpoint as a mobile client
//! (the same route as youtube-transcript-api and yt-dlp, ported from qiaomu-clipper), then fetch the chosen track.
use crate::model::Segment;
use crate::net;
use crate::transcript;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

/// Overrides from the remote config (`youtubeClients`), so a YouTube change can be answered without a release.
static REMOTE_CLIENTS: std::sync::RwLock<Vec<(String, String, Option<u32>)>> = std::sync::RwLock::new(Vec::new());

/// `[{"name": "ANDROID", "version": "20.10.38", "sdk": 34}, …]`; ignored when empty or malformed.
pub fn set_clients(v: &Value) {
    let list: Vec<(String, String, Option<u32>)> = v.as_array().into_iter().flatten().filter_map(|c| {
        Some((c["name"].as_str()?.to_string(), c["version"].as_str()?.to_string(), c["sdk"].as_u64().map(|n| n as u32)))
    }).collect();
    if !list.is_empty() { *REMOTE_CLIENTS.write().unwrap() = list; }
}

fn clients() -> Vec<(String, String, Option<u32>)> {
    let remote = REMOTE_CLIENTS.read().unwrap().clone();
    if !remote.is_empty() { return remote; }
    CLIENTS.iter().map(|(n, v, s)| (n.to_string(), v.to_string(), *s)).collect()
}

const CLIENTS: &[(&str, &str, Option<u32>)] = &[
    ("ANDROID", "20.10.38", Some(34)),
    ("IOS", "20.10.3", None),
    ("ANDROID_VR", "1.60.19", Some(32)),
];

#[derive(Clone, Debug)]
pub struct Track {
    pub base_url: String,
    video_id: String,
    client_name: String,
    agent: String,
    pub language: String,
    pub auto: bool,
}

pub struct VideoInfo {
    pub title: String,
    pub author: String,
    pub duration: Option<f64>,
    pub description: String,
    pub tracks: Vec<Track>,
    /// The spoken language, when YouTube marks one audio track as the original (videos with dubbed audio).
    pub original_language: Option<String>,
}

fn original_language(player: &Value) -> Option<String> {
    let mut found = std::collections::BTreeSet::new();
    for key in ["formats", "adaptiveFormats"] {
        for f in player["streamingData"][key].as_array().into_iter().flatten() {
            let a = &f["audioTrack"];
            if a["displayName"].as_str().is_some_and(|n| n.to_lowercase().contains("original")) {
                if let Some(id) = a["id"].as_str() { found.insert(base(id.split('.').next().unwrap_or(id))); }
            }
        }
    }
    (found.len() == 1).then(|| found.into_iter().next().unwrap())
}

fn base(lang: &str) -> String { lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase() }

fn tracks_of(player: &Value, video_id: &str, client_name: &str, agent: &str) -> Vec<Track> {
    player["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let url = t["baseUrl"].as_str()?;
            // Token-gated tracks need the web player's proof; skip them.
            if url.contains("exp=xpe") { return None; }
            Some(Track { video_id: video_id.into(), client_name: client_name.into(), agent: agent.into(), base_url: url.to_string(), language: t["languageCode"].as_str().unwrap_or("und").to_string(), auto: t["kind"].as_str() == Some("asr") })
        })
        .collect()
}

pub async fn video_info(video_id: &str) -> Result<VideoInfo> {
    let mut list = clients();
    list.sort_by_key(|(name, _, _)| name != "IOS");
    video_info_from(video_id, list).await
}

async fn video_info_from(video_id: &str, list: Vec<(String, String, Option<u32>)>) -> Result<VideoInfo> {
    let mut last_err = anyhow!("YouTube 没有返回视频信息");
    let mut fallback: Option<VideoInfo> = None;
    for (name, version, sdk) in list {
        let mut client = json!({ "clientName": name, "clientVersion": version, "hl": "en" });
        if let Some(sdk) = sdk { client["androidSdkVersion"] = json!(sdk); }
        let agent = ua_for(&name, &version, sdk);
        if name == "IOS" { client["deviceModel"] = json!("iPhone16,2"); }
        let body = json!({ "context": { "client": client }, "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true });
        let res = net::client().post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false").header("User-Agent", &agent).timeout(std::time::Duration::from_secs(8)).json(&body).send().await;
        let player: Value = match res {
            Ok(r) if r.status().is_success() => match r.json().await { Ok(v) => v, Err(e) => { last_err = e.into(); continue; } },
            Ok(r) => { last_err = anyhow!("YouTube {}", r.status()); continue; }
            Err(e) => { last_err = anyhow!("连不上 YouTube（国内需要设置代理）：{e}"); continue; }
        };
        let d = &player["videoDetails"];
        let info = VideoInfo {
            title: d["title"].as_str().unwrap_or("").to_string(),
            author: d["author"].as_str().unwrap_or("").to_string(),
            duration: d["lengthSeconds"].as_str().and_then(|s| s.parse().ok()),
            description: d["shortDescription"].as_str().unwrap_or("").to_string(),
            tracks: tracks_of(&player, video_id, &name, &agent),
            original_language: original_language(&player),
        };
        if !info.tracks.is_empty() { return Ok(info); }
        if fallback.is_none() && !info.title.is_empty() { fallback = Some(info); }
    }
    fallback.ok_or(last_err)
}

/// Direct media addresses from InnerTube, for phones (no yt-dlp): an HLS manifest (iOS client), a muxed MP4 and the
/// best audio-only stream. `ua` is the client the addresses were issued to; googlevideo wants the same User-Agent.
#[derive(Default, Clone, Debug)]
pub struct Streams { pub hls: Option<String>, pub mp4: Option<String>, pub audio: Option<String>, pub ua: String }

fn ua_for(name: &str, version: &str, sdk: Option<u32>) -> String {
    match name {
        "IOS" => format!("com.google.ios.youtube/{version} (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"),
        "ANDROID_VR" => format!("com.google.android.apps.youtube.vr.oculus/{version} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"),
        _ => format!("com.google.android.youtube/{version} (Linux; U; Android 14; en_US; sdk {}) gzip", sdk.unwrap_or(34)),
    }
}

#[derive(Clone, Copy)]
pub enum StreamUse { Audio, Video, Hls, Mp4 }

impl StreamUse {
    fn accepts(self, streams: &Streams) -> bool {
        match self {
            Self::Audio => streams.audio.is_some(),
            Self::Video => streams.hls.is_some() || streams.mp4.is_some(),
            Self::Hls => streams.hls.is_some(),
            Self::Mp4 => streams.mp4.is_some(),
        }
    }
}

pub async fn streams(video_id: &str, purpose: StreamUse) -> Result<Streams> {
    use futures_util::{stream, StreamExt};
    let mut list = clients();
    list.sort_by_key(|(name, _, _)| name != "IOS");
    // Give the HLS client a head start. A slow or audio-only response must not block the muxed client.
    let requests = stream::iter(list.into_iter().enumerate()).map(|(index, (name, version, sdk))| async move {
        if index == 1 && !matches!(purpose, StreamUse::Audio) {
            tokio::time::sleep(std::time::Duration::from_millis(180)).await;
        }
        resolve_stream(video_id, purpose, name, version, sdk).await
    });
    let mut results = requests.buffer_unordered(if matches!(purpose, StreamUse::Audio) { 1 } else { 2 });
    let mut last_err = anyhow!("YouTube 没有返回可播放的地址");
    while let Some(result) = results.next().await {
        match result { Ok(streams) => return Ok(streams), Err(err) => last_err = err }
    }
    Err(last_err)
}

async fn resolve_stream(video_id: &str, purpose: StreamUse, name: String, version: String, sdk: Option<u32>) -> Result<Streams> {
    let mut client = json!({ "clientName": name, "clientVersion": version, "hl": "en" });
    if let Some(sdk) = sdk { client["androidSdkVersion"] = json!(sdk); }
    if name == "IOS" { client["deviceModel"] = json!("iPhone16,2"); }
    let ua = ua_for(&name, &version, sdk);
    let body = json!({ "context": { "client": client }, "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true });
    let response = net::client().post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", &ua).json(&body).send().await
        .map_err(net::describe)?.error_for_status()?;
    let player: Value = response.json().await?;
    let status = player["playabilityStatus"]["status"].as_str().unwrap_or("");
    if status != "OK" {
        return Err(anyhow!("YouTube 不让播放这个视频（{}）", player["playabilityStatus"]["reason"].as_str().unwrap_or(status)));
    }
    let sd = &player["streamingData"];
    let url_of = |f: &Value| f["url"].as_str().map(str::to_string);
    let mp4 = sd["formats"].as_array().into_iter().flatten()
        .filter(|f| f["mimeType"].as_str().is_some_and(|m| m.starts_with("video/mp4")) && f["url"].is_string())
        .max_by_key(|f| f["height"].as_u64().unwrap_or(0)).and_then(url_of);
    let audios: Vec<&Value> = sd["adaptiveFormats"].as_array().into_iter().flatten()
        .filter(|f| f["mimeType"].as_str().is_some_and(|m| m.starts_with("audio/mp4")) && f["url"].is_string()).collect();
    // The original-language track when the video has dubs; the highest bitrate otherwise.
    let original = audios.iter().filter(|f| f["audioTrack"]["displayName"].as_str().is_some_and(|n| n.to_lowercase().contains("original"))).max_by_key(|f| f["bitrate"].as_u64().unwrap_or(0));
    let audio = original.or_else(|| audios.iter().filter(|f| f["audioTrack"].is_null() || f["audioTrack"]["audioIsDefault"].as_bool() == Some(true)).max_by_key(|f| f["bitrate"].as_u64().unwrap_or(0)))
        .or_else(|| audios.iter().max_by_key(|f| f["bitrate"].as_u64().unwrap_or(0))).and_then(|f| url_of(f));
    let out = Streams { hls: sd["hlsManifestUrl"].as_str().map(str::to_string), mp4, audio, ua };
    if purpose.accepts(&out) { return Ok(out); }
    Err(anyhow!("YouTube 没有给出可直接播放的地址"))
}

/// Downloads a googlevideo stream in 8 MB ranges (a single request is throttled to real-time speed).
pub async fn download_stream(url: &str, ua: &str, dest: &std::path::Path, cancel: &std::sync::atomic::AtomicBool, mut progress: impl FnMut(u64, Option<u64>)) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    const STEP: u64 = 8 * 1024 * 1024;
    let total: Option<u64> = url.split_once("clen=").and_then(|(_, t)| t.split('&').next()?.parse().ok());
    let mut file = tokio::fs::File::create(dest).await?;
    let mut got = 0u64;
    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) { return Err(anyhow!("已取消")); }
        let end = got + STEP - 1;
        let r = net::client().get(format!("{url}&range={got}-{end}")).header("User-Agent", ua).send().await?;
        if !r.status().is_success() { return Err(anyhow!("下载 YouTube 音频失败（{}）", r.status().as_u16())); }
        let bytes = r.bytes().await?;
        if bytes.is_empty() { break; }
        file.write_all(&bytes).await?;
        got += bytes.len() as u64;
        progress(got, total);
        if (bytes.len() as u64) < STEP || total.is_some_and(|t| got >= t) { break; }
    }
    file.flush().await?;
    if got == 0 { return Err(anyhow!("YouTube 音频是空的")); }
    Ok(())
}

/// The track to show: a human-made one in the spoken language, else the auto track in that language.
/// Videos with dubbed audio carry one auto track per dub, so the spoken language comes from the audio track
/// YouTube marks "original"; with a single auto track, that track's language is the spoken one.
/// With no audio-track or single-auto-track evidence, the spoken language is guessed from `hint` (the title's
/// script, see `script_hint`): a Chinese show that also uploads English subtitles must not open in English.
pub fn choose<'a>(tracks: &'a [Track], original: Option<&str>, hint: Option<&str>) -> Option<&'a Track> {
    let autos: Vec<&Track> = tracks.iter().filter(|t| t.auto).collect();
    let spoken = original.map(base).or_else(|| (autos.len() == 1).then(|| base(&autos[0].language))).or_else(|| hint.map(base));
    if let Some(sp) = &spoken {
        if let Some(t) = tracks.iter().find(|t| !t.auto && &base(&t.language) == sp) { return Some(t); }
        if let Some(t) = autos.iter().find(|t| &base(&t.language) == sp) { return Some(t); }
    }
    tracks.iter().find(|t| !t.auto && base(&t.language) == "en")
        .or_else(|| autos.iter().copied().find(|t| base(&t.language) == "en"))
        .or_else(|| tracks.iter().find(|t| !t.auto))
        .or_else(|| tracks.first())
}

/// The language a title is most likely spoken in, from its script: kana means Japanese, hangul Korean, and
/// Han characters (without kana) Chinese. None for Latin and other scripts, which say little on their own.
pub fn script_hint(title: &str) -> Option<&'static str> {
    let has = |lo: char, hi: char| title.chars().any(|c| (lo..=hi).contains(&c));
    if has('\u{3040}', '\u{30ff}') { Some("ja") }
    else if has('\u{ac00}', '\u{d7af}') { Some("ko") }
    else if title.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count() >= 2 { Some("zh") }
    else { None }
}

/// The publisher's own Simplified Chinese subtitles, when the video is in another language and has them:
/// better than machine translation, so they become the Chinese line of the bilingual view.
pub fn official_chinese<'a>(tracks: &'a [Track], spoken: &str) -> Option<&'a Track> {
    if base(spoken) == "zh" { return None; }
    let zh: Vec<&Track> = tracks.iter().filter(|t| !t.auto && base(&t.language) == "zh").collect();
    zh.iter().find(|t| matches!(t.language.as_str(), "zh-Hans" | "zh-CN" | "zh-SG" | "zh")).or(zh.first()).copied()
}

/// Puts each line of another track under the original segment its midpoint falls in. None for segments
/// nothing lands in; the caller decides whether the coverage is good enough to use.
pub fn align(orig: &[Segment], other: &[Segment]) -> Vec<Option<String>> {
    let mut out: Vec<Option<String>> = vec![None; orig.len()];
    for s in other {
        let mid = (s.start + s.end) / 2.0;
        let i = orig.partition_point(|o| o.start <= mid).saturating_sub(1);
        if orig.is_empty() || mid > orig[i].end + 2.0 { continue; }
        let text = s.text.trim();
        if text.is_empty() { continue; }
        match &mut out[i] { Some(prev) => prev.push_str(text), slot => *slot = Some(text.to_string()) }
    }
    out
}

pub async fn fetch_track(track: &Track) -> Result<Vec<Segment>> {
    if let Ok(lines) = read_track(track).await { return Ok(lines); }
    // Listing a language does not guarantee its body is available from that client.
    // Ask for a fresh published track, retaining the language and manual/automatic choice.
    for client in clients().into_iter().filter(|(name, _, _)| name != &track.client_name) {
        if let Ok(info) = video_info_from(&track.video_id, vec![client]).await {
            if let Some(other) = info.tracks.iter().find(|t| t.language == track.language && t.auto == track.auto) {
                if let Ok(lines) = read_track(other).await { return Ok(lines); }
            }
        }
    }
    Err(anyhow!("字幕下载失败"))
}

async fn read_track(track: &Track) -> Result<Vec<Segment>> {
    let base = &track.base_url;
    let without_format = regex::Regex::new(r"&fmt=[^&]*").unwrap().replace_all(base, "");
    for url in [format!("{without_format}&fmt=json3"), base.clone()] {
        let response = net::client().get(url).header("User-Agent", &track.agent)
            .timeout(std::time::Duration::from_secs(8)).send().await?;
        if !response.status().is_success() { break; }
        let body = response.text().await?;
        let rows = transcript::parse_youtube(&body);
        if !rows.is_empty() { return Ok(rows); }
    }
    Err(anyhow!("字幕下载失败"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(l: &str, auto: bool) -> Track { Track { video_id: String::new(), client_name: String::new(), agent: String::new(), base_url: String::new(), language: l.into(), auto } }
    #[test]
    fn dubbed_video_picks_original() {
        let tracks = vec![t("ar", true), t("en", true), t("en-US", false), t("de", true)];
        assert_eq!(choose(&tracks, Some("en"), None).unwrap().language, "en-US");
        assert_eq!(choose(&tracks, None, None).unwrap().language, "en-US");
        let only_auto = vec![t("ar", true), t("en", true)];
        assert_eq!(choose(&only_auto, None, None).unwrap().language, "en");
        assert_eq!(choose(&[t("ja", true)], None, None).unwrap().language, "ja");
    }
    #[test]
    fn chinese_show_with_english_subtitles_opens_in_chinese() {
        // 词元之外 #010: uploaded zh-Hans and en, plus auto zh-Hans and en.
        let tracks = vec![t("en", false), t("zh-Hans", false), t("zh-Hans", true), t("en", true)];
        let hint = script_hint("#010 黄仁勋辞职，Fable 杀死比赛，语言即世界");
        assert_eq!(hint, Some("zh"));
        assert_eq!(choose(&tracks, None, hint).unwrap().language, "zh-Hans");
        assert!(official_chinese(&tracks, "zh-Hans").is_none());
        assert_eq!(script_hint("Recursive self-improvement has started"), None);
        assert_eq!(script_hint("ChatGPTの使い方"), Some("ja"));
    }
    #[test]
    fn english_video_takes_the_publishers_chinese() {
        let tracks = vec![t("en", false), t("zh-TW", false), t("zh-Hans", false), t("en", true)];
        assert_eq!(official_chinese(&tracks, "en").unwrap().language, "zh-Hans");
        let seg = |s: f64, e: f64, x: &str| Segment { start: s, end: e, text: x.into() };
        let orig = vec![seg(0.0, 4.0, "Hello there."), seg(4.0, 9.0, "How are you?"), seg(9.0, 12.0, "Fine.")];
        let zh = vec![seg(0.2, 2.0, "你好"), seg(2.0, 3.8, "呀。"), seg(4.5, 8.0, "你好吗？")];
        assert_eq!(align(&orig, &zh), vec![Some("你好呀。".into()), Some("你好吗？".into()), None]);
    }
}


#[cfg(test)]
mod stream_tests {
    use super::*;

    #[test]
    fn audio_only_response_does_not_end_video_lookup() {
        let audio = Streams { audio: Some("audio".into()), ..Default::default() };
        assert!(StreamUse::Audio.accepts(&audio));
        assert!(!StreamUse::Video.accepts(&audio));
        let hls = Streams { hls: Some("hls".into()), ..Default::default() };
        assert!(StreamUse::Video.accepts(&hls));
        assert!(StreamUse::Hls.accepts(&hls));
        assert!(!StreamUse::Hls.accepts(&audio));
        assert!(!StreamUse::Mp4.accepts(&hls));
    }
}
