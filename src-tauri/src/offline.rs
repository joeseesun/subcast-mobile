//! Episodes saved for listening offline: one audio file per episode, named by episode id, in `downloads/`.
use crate::{asr, model::Episode};
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub episode_id: String,
    pub path: String,
    pub bytes: u64,
    pub saved_at: i64,
}

pub fn dir(data: &Path) -> PathBuf { data.join("downloads") }

/// The file extension an audio address points at (mp3 when it does not say).
pub fn audio_ext(url: &str) -> String {
    url.split('?').next().and_then(|u| u.rsplit('/').next()).and_then(|f| f.rsplit_once('.')).map(|(_, x)| x)
        .filter(|x| (2..=4).contains(&x.len()) && x.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or("mp3").to_lowercase()
}

fn saved_file(p: &Path) -> Option<Saved> {
    let id = p.file_stem()?.to_str()?;
    let ext = p.extension()?.to_str()?;
    if ext == "part" || id.starts_with('.') { return None; }
    let meta = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let saved_at = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
    Some(Saved { episode_id: id.to_string(), path: p.to_string_lossy().into_owned(), bytes: meta.len(), saved_at })
}

pub fn list(data: &Path) -> Vec<Saved> {
    let Ok(rd) = std::fs::read_dir(dir(data)) else { return vec![] };
    let mut out: Vec<Saved> = rd.flatten().filter_map(|e| saved_file(&e.path())).collect();
    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    out
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
        let dest = d.join(format!("{}.{}", ep.id, audio_ext(url)));
        asr::download(url, &dest, &cancel, |got, total| progress(total.map(|t| got as f64 / t.max(1) as f64))).await?;
        dest
    } else if let Some(vid) = &ep.video_id {
        let s = crate::youtube::streams(vid).await?;
        let url = s.audio.ok_or_else(|| anyhow!("YouTube 没有给出这个视频的音频地址"))?;
        let dest = d.join(format!("{}.m4a", ep.id));
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
