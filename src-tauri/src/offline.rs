//! Offline audio in `downloads/`. New caches carry a filename prefix so existing downloads remain durable.
use crate::{asr, model::Episode};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

const CACHE_PREFIX: &str = "cache-";
const CACHE_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub episode_id: String,
    pub path: String,
    pub bytes: u64,
    pub saved_at: i64,
    pub cached: bool,
}

pub fn dir(data: &Path) -> PathBuf { data.join("downloads") }

/// The file extension an audio address points at (mp3 when it does not say).
pub fn audio_ext(url: &str) -> String {
    url.split('?').next().and_then(|u| u.rsplit('/').next()).and_then(|f| f.rsplit_once('.')).map(|(_, x)| x)
        .filter(|x| (2..=4).contains(&x.len()) && x.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or("mp3").to_lowercase()
}

fn saved_file(p: &Path) -> Option<Saved> {
    let stem = p.file_stem()?.to_str()?;
    let cached = stem.starts_with(CACHE_PREFIX);
    let id = stem.strip_prefix(CACHE_PREFIX).unwrap_or(stem);
    let ext = p.extension()?.to_str()?;
    if ext == "part" || id.starts_with('.') { return None; }
    let meta = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let saved_at = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
    Some(Saved { episode_id: id.to_string(), path: p.to_string_lossy().into_owned(), bytes: meta.len(), saved_at, cached })
}

pub fn list(data: &Path) -> Vec<Saved> {
    let Ok(rd) = std::fs::read_dir(dir(data)) else { return vec![] };
    let mut out: Vec<Saved> = rd.flatten().filter_map(|e| saved_file(&e.path())).collect();
    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    out
}

/// Called before playback starts on a cold launch. Legacy downloads have no expiry.
pub fn prune_cache(data: &Path, now: SystemTime) {
    for item in list(data).into_iter().filter(|item| item.cached) {
        let written = SystemTime::UNIX_EPOCH + Duration::from_millis(item.saved_at.max(0) as u64);
        if now.duration_since(written).is_ok_and(|age| age >= CACHE_AGE) {
            let _ = std::fs::remove_file(item.path);
        }
    }
}

/// Renew a cache for a listening session, at most once a day.
pub fn renew_cache(data: &Path, episode_id: &str) {
    let Ok(files) = std::fs::read_dir(dir(data)) else { return };
    let stem = format!("{CACHE_PREFIX}{episode_id}");
    for file in files.flatten() {
        let path = file.path();
        if path.file_stem().and_then(|value| value.to_str()) != Some(stem.as_str()) || path.extension().is_some_and(|value| value == "part") {
            continue;
        }
        if let Ok(meta) = file.metadata() {
            let now = SystemTime::now();
            if meta.modified().ok().and_then(|time| now.duration_since(time).ok()).is_some_and(|age| age >= Duration::from_secs(86_400)) {
                if let Ok(cache) = std::fs::File::open(path) { let _ = cache.set_modified(now); }
            }
        }
    }
}

pub fn find(data: &Path, episode_id: &str) -> Option<Saved> { list(data).into_iter().find(|s| s.episode_id == episode_id) }

pub fn remove(data: &Path, episode_id: &str) -> Result<()> {
    if let Some(s) = find(data, episode_id) { std::fs::remove_file(s.path)?; }
    Ok(())
}

pub fn clear(data: &Path) -> Result<()> {
    let d = dir(data);
    if d.is_dir() { std::fs::remove_dir_all(&d)?; }
    Ok(())
}

/// Saves the episode's audio. Podcasts download their audio file (progress 0–1); YouTube videos save their audio
/// audio track straight from InnerTube (youtube.rs).
pub async fn download(data: &Path, ep: &Episode, cancel: Arc<AtomicBool>, mut progress: impl FnMut(Option<f64>)) -> Result<Saved> {
    let d = dir(data);
    tokio::fs::create_dir_all(&d).await?;
    let dest = if let Some(url) = &ep.audio_url {
        let dest = d.join(format!("{CACHE_PREFIX}{}.{}", ep.id, audio_ext(url)));
        let result = asr::download(url, &dest, &cancel, |got, total| progress(total.map(|t| got as f64 / t.max(1) as f64))).await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(dest.with_extension("part")).await;
            return Err(error);
        }
        dest
    } else if let Some(vid) = &ep.video_id {
        let s = crate::youtube::streams(vid, crate::youtube::StreamUse::Audio).await?;
        let url = s.audio.ok_or_else(|| anyhow!("YouTube 没有给出这个视频的音频地址"))?;
        let dest = d.join(format!("{CACHE_PREFIX}{}.m4a", ep.id));
        let part = d.join(format!(".tmp-{}.m4a", ep.id));
        let r = crate::youtube::download_stream(&url, &s.ua, &part, &cancel, |got, total| progress(total.map(|t| got as f64 / t.max(1) as f64))).await;
        if let Err(err) = r { let _ = tokio::fs::remove_file(&part).await; return Err(err); }
        tokio::fs::rename(&part, &dest).await?;
        dest
    } else {
        return Err(anyhow!("这集没有音频地址"));
    };
    progress(Some(1.0));
    saved_file(&dest).ok_or_else(|| anyhow!("下载失败"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extensions() {
        assert_eq!(audio_ext("https://a.com/x/ep.MP3?t=1"), "mp3");
        assert_eq!(audio_ext("https://a.com/x/ep.m4a"), "m4a");
        assert_eq!(audio_ext("https://a.com/x/redirect"), "mp3");
        assert_eq!(audio_ext("https://a.com/v1.2/stream"), "mp3");
    }
    #[test]
    fn expires_only_stale_audio_caches() {
        let data = std::env::temp_dir().join(format!("subcast-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir(&data)).unwrap();
        let now = SystemTime::now();
        for name in ["old.mp3", "cache-old.mp3", "cache-fresh.mp3"] {
            let file = std::fs::File::create(dir(&data).join(name)).unwrap();
            if name != "cache-fresh.mp3" { file.set_modified(now - CACHE_AGE - Duration::from_secs(60)).unwrap(); }
        }
        prune_cache(&data, now);
        assert!(!dir(&data).join("cache-old.mp3").exists());
        assert!(!find(&data, "old").unwrap().cached);
        assert!(find(&data, "fresh").unwrap().cached);
        clear(&data).unwrap();
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn lists_only_finished_files() {
        let data = std::env::temp_dir().join(format!("subcast-offline-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir(&data)).unwrap();
        std::fs::write(dir(&data).join("a.mp3"), b"123").unwrap();
        std::fs::write(dir(&data).join("b.part"), b"1").unwrap();
        std::fs::create_dir_all(dir(&data).join(".tmp-c")).unwrap();
        let l = list(&data);
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].episode_id.as_str(), l[0].bytes), ("a", 3));
        remove(&data, "a").unwrap();
        assert!(find(&data, "a").is_none());
        clear(&data).unwrap();
        let _ = std::fs::remove_dir_all(&data);
    }
}
