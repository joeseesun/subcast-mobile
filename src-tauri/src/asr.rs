//! Audio for cloud speech recognition on a phone: download the episode, decode it to 16 kHz mono (pure Rust,
//! symphonia) and hand the samples to cloud.rs. There is no local recogniser and no yt-dlp on mobile: YouTube
//! audio comes straight from InnerTube's stream list (youtube.rs).
use crate::model::Segment;
use crate::net;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::AsyncWriteExt;

/// Streams `url` into `dest` (via a .part file), reporting (received, total). Stops when `cancel` is set.
pub async fn download(url: &str, dest: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64, Option<u64>)) -> Result<()> {
    let res = net::client().get(url).send().await?;
    if !res.status().is_success() { return Err(anyhow!("下载失败（{}）", res.status().as_u16())); }
    let total = res.content_length();
    let part = dest.with_extension("part");
    if let Some(dir) = dest.parent() { tokio::fs::create_dir_all(dir).await?; }
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = res.bytes_stream();
    let mut received = 0u64;
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(anyhow!("已取消"));
        }
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if last.elapsed().as_millis() > 200 { progress(received, total); last = std::time::Instant::now(); }
    }
    file.flush().await?;
    drop(file);
    if let Some(t) = total { if received < t { return Err(anyhow!("下载不完整")); } }
    tokio::fs::rename(&part, dest).await?;
    progress(received, total);
    Ok(())
}

/// Background for a recogniser, in each form one reads (built by asr_context.rs; empty when there is none).
#[derive(Default, Clone, Debug)]
pub struct AsrContext {
    /// Whisper-style initial prompt (short; the end matters most).
    pub prompt: String,
    /// Qwen3-ASR `--context`, read whole.
    pub background: String,
    /// Doubao `corpus.context` JSON string.
    pub doubao: String,
    /// Names and terms from the episode's glossary, when one was made.
    #[allow(dead_code)]
    pub hotwords: Vec<String>,
}

pub struct WorkerResult {
    pub language: String,
    pub segments: Vec<Segment>,
}


/// Decodes any supported audio file to 16 kHz mono 16-bit samples. Works through the file in blocks of about
/// 30 s, so an hour of audio peaks at ~115 MB instead of holding the whole file at its own rate in f32.
pub fn decode_16k_mono(path: &Path) -> Result<Vec<i16>> {
    use symphonia::core::{audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint};
    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) { hint.with_extension(ext); }
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| anyhow!("无法识别音频格式：{e}"))?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL).ok_or_else(|| anyhow!("没有音轨"))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(|e| anyhow!("不支持的音频编码：{e}"))?;
    let mut rate = track.codec_params.sample_rate.unwrap_or(44100);
    let mut block: Vec<f32> = Vec::new();
    let mut out: Vec<i16> = Vec::new();
    let mut buf: Option<SampleBuffer<f32>> = None;
    let flush = |block: &mut Vec<f32>, out: &mut Vec<i16>, rate: u32| {
        out.extend(resample(block, rate, 16000).into_iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16));
        block.clear();
    };
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(anyhow!("读取音频失败：{e}")),
        };
        if packet.track_id() != track_id { continue; }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(anyhow!("解码失败：{e}")),
        };
        let spec = *decoded.spec();
        if spec.rate != rate && !block.is_empty() { flush(&mut block, &mut out, rate); }
        rate = spec.rate;
        let channels = spec.channels.count().max(1);
        if buf.as_ref().is_none_or(|b| b.capacity() < decoded.capacity() * channels) {
            buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let b = buf.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        for frame in b.samples().chunks(channels) { block.push(frame.iter().sum::<f32>() / channels as f32); }
        if block.len() >= rate as usize * 30 { flush(&mut block, &mut out, rate); }
    }
    if !block.is_empty() { flush(&mut block, &mut out, rate); }
    Ok(out)
}

/// Box-filtered linear resampling: plenty for speech recognition.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() { return input.to_vec(); }
    let ratio = from as f64 / to as f64;
    let width = ratio.ceil().max(1.0) as usize;
    let filtered: Vec<f32> = if width > 1 {
        let mut acc = 0.0f32;
        let mut out = Vec::with_capacity(input.len());
        for i in 0..input.len() {
            acc += input[i];
            if i >= width { acc -= input[i - width]; }
            out.push(acc / width.min(i + 1) as f32);
        }
        out
    } else { input.to_vec() };
    let n = (input.len() as f64 / ratio) as usize;
    (0..n).map(|i| {
        let pos = i as f64 * ratio;
        let j = pos as usize;
        let frac = (pos - j as f64) as f32;
        let a = filtered[j.min(filtered.len() - 1)];
        let b = filtered[(j + 1).min(filtered.len() - 1)];
        a + (b - a) * frac
    }).collect()
}


pub mod streams {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static FILE: once_cell::sync::OnceCell<PathBuf> = once_cell::sync::OnceCell::new();
    static MAP: once_cell::sync::Lazy<Mutex<HashMap<String, (String, u64)>>> = once_cell::sync::Lazy::new(|| {
        let saved = FILE.get().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Mutex::new(saved)
    });
    const MARGIN: u64 = 20 * 60;
    const DEFAULT_LIFE: u64 = 4 * 3600;

    fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

    /// Where to persist; call once before the first lookup.
    pub fn init(data: &std::path::Path) { let _ = FILE.set(data.join("streams.json")); }

    /// YouTube's expiry time in a stream address: `expire=1700000000` in the query or `/expire/1700000000/` in an HLS path.
    pub fn expiry(url: &str) -> Option<u64> {
        let tail = url.split_once("expire=").or_else(|| url.split_once("/expire/"))?.1;
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse().ok()
    }

    pub fn get(key: &str) -> Option<String> {
        let map = MAP.lock().unwrap();
        map.get(key).filter(|(_, until)| *until > now()).map(|(u, _)| u.clone())
    }

    pub fn put(key: &str, url: &str) {
        let t = now();
        let until = expiry(url).map(|e| e.saturating_sub(MARGIN)).unwrap_or(t + DEFAULT_LIFE);
        let mut map = MAP.lock().unwrap();
        map.retain(|_, (_, u)| *u > t);
        if until > t { map.insert(key.to_string(), (url.to_string(), until)); }
        if let (Some(f), Ok(b)) = (FILE.get(), serde_json::to_vec(&*map)) { let _ = std::fs::write(f, b); }
    }

    #[cfg(test)]
    mod tests {
        use super::expiry;
        #[test]
        fn reads_expiry() {
            assert_eq!(expiry("https://rr1.googlevideo.com/videoplayback?expire=1700000000&ei=x"), Some(1700000000));
            assert_eq!(expiry("https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1700001234/ei/abc/file/index.m3u8"), Some(1700001234));
            assert_eq!(expiry("https://example.com/a.mp4"), None);
        }
    }
}
