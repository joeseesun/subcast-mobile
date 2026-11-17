mod asr;
mod asr_context;
mod cloud;
mod db;
mod feeds;
mod hlsproxy;
mod import;
mod llm;
mod model;
mod net;
mod offline;
#[cfg_attr(debug_assertions, allow(dead_code))] // serving the interface is release-only
mod ota;
mod qiaomu;
mod shared;
mod transcript;
mod translate;
mod youtube;

use model::*;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// The port the bundled app serves its pages from. YouTube's embedded player refuses pages served from the
/// `tauri://` scheme (no valid origin / referrer), so release builds use http://localhost like a normal website.
#[cfg(not(debug_assertions))]
const LOCAL_PORT: u16 = 14327;

pub struct AppState {
    db: Mutex<Connection>,
    data: PathBuf,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    fn job(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.jobs.lock().unwrap().insert(id.to_string(), flag.clone());
        flag
    }
    fn done(&self, id: &str) { self.jobs.lock().unwrap().remove(id); }
}

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String { err.to_string() }

// ---- subscriptions ---------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Added { show: Option<Show>, episode: Option<Episode> }

fn store(state: &AppState, show: &Show, eps: &[Episode]) -> Res<()> {
    let mut conn = state.db.lock().unwrap();
    db::upsert_show(&conn, show).map_err(e)?;
    db::upsert_episodes(&mut conn, eps).map_err(e)?;
    Ok(())
}

/// Fetches any subscription's latest state. 乔木精读 channels also bring curated Chinese titles, which go straight
/// into the translation cache so the UI shows them instead of machine translations.
async fn fetch_any(state: &AppState, feed_url: &str, kind: &str) -> anyhow::Result<(Show, Vec<Episode>)> {
    if kind == "qiaomu" {
        let ch = if let Some(id) = qiaomu::rss_source_id(feed_url) { qiaomu::rss_channel(&id).await? } else {
            let id = qiaomu::site_id(feed_url).ok_or_else(|| anyhow::anyhow!("不是精读频道"))?;
            qiaomu::channel(&id).await?
        };
        let conn = state.db.lock().unwrap();
        for (orig, zh) in &ch.zh_titles { let _ = db::tr_put(&conn, &short_hash(&format!("zh-CN|{orig}"), 24), zh); }
        return Ok((ch.show, ch.episodes));
    }
    feeds::fetch_show(feed_url, kind).await
}

async fn single_youtube(state: &AppState, video_id: &str) -> Res<Episode> {
    let info = youtube::video_info(video_id).await.map_err(e)?;
    let ep = Episode {
        id: short_hash(&format!("single:{video_id}"), 20),
        show_id: "single".into(),
        guid: video_id.into(),
        title: if info.title.is_empty() { video_id.to_string() } else { info.title },
        published: Some(now_ms()),
        duration: info.duration,
        video_id: Some(video_id.into()),
        link: Some(format!("https://www.youtube.com/watch?v={video_id}")),
        cover: Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")),
        notes: Some(format!("{}\n\n{}", info.author, info.description)),
        ..Default::default()
    };
    let mut conn = state.db.lock().unwrap();
    db::upsert_episodes(&mut conn, std::slice::from_ref(&ep)).map_err(e)?;
    Ok(db::get_episode(&conn, &ep.id).map_err(e)?.unwrap_or(ep))
}

enum Fetched { Show(Show, Vec<Episode>), Single(Episode) }

/// Reads whatever the user pasted (or a curated channel) without subscribing.
async fn fetch_input(state: &AppState, input: &str) -> Res<Fetched> {
    let normalized = if input.trim().starts_with("http") { input.trim().to_string() } else { format!("https://{}", input.trim()) };
    if let Some(id) = qiaomu::rss_source_id(&normalized) {
        let (show, eps) = fetch_any(state, &qiaomu::rss_feed_url(&id), "qiaomu").await.map_err(e)?;
        return Ok(Fetched::Show(show, eps));
    }
    if let Some(id) = qiaomu::site_id(&normalized) {
        let (show, eps) = fetch_any(state, &qiaomu::feed_url(&id), "qiaomu").await.map_err(e)?;
        return Ok(Fetched::Show(show, eps));
    }
    let (show, eps) = match feeds::resolve(input).await.map_err(e)? {
        feeds::Source::YouTubeVideo(id) => return Ok(Fetched::Single(single_youtube(state, &id).await?)),
        feeds::Source::XiaoyuzhouEpisode(url) => {
            let mut ep = feeds::xiaoyuzhou_episode(&url).await.map_err(e)?;
            ep.id = short_hash(&format!("single:{}", ep.guid), 20);
            let mut conn = state.db.lock().unwrap();
            db::upsert_episodes(&mut conn, std::slice::from_ref(&ep)).map_err(e)?;
            let ep = db::get_episode(&conn, &ep.id).map_err(e)?.unwrap_or(ep);
            return Ok(Fetched::Single(ep));
        }
        feeds::Source::Xiaoyuzhou(url) => feeds::xiaoyuzhou_show(&url).await.map_err(e)?,
        feeds::Source::Feed(url) => match feeds::fetch_show(&url, "podcast").await {
            Ok(r) if !r.1.is_empty() => r,
            // A channel with no long-form videos: fall back to everything it uploads.
            other if url.contains("playlist_id=UULF") => {
                let all = url.replace("playlist_id=UULF", "channel_id=UC");
                match feeds::fetch_show(&all, "podcast").await { Ok(r) => r, Err(err) => return Err(other.err().map(e).unwrap_or_else(|| e(err))) }
            }
            other => other.map_err(e)?,
        },
    };
    if eps.is_empty() { return Err("这个订阅源里没有可播放的节目".into()); }
    Ok(Fetched::Show(show, eps))
}

#[tauri::command]
async fn add_subscription(state: State<'_, AppState>, input: String) -> Res<Added> {
    match fetch_input(&state, &input).await? {
        Fetched::Single(ep) => Ok(Added { show: None, episode: Some(ep) }),
        Fetched::Show(show, eps) => { store(&state, &show, &eps)?; Ok(Added { show: Some(show), episode: None }) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview { show: Show, episodes: Vec<Episode>, fetched_at: i64 }

/// The id a channel input will have, when that can be known without the network (curated 精读 sites, direct feeds).
fn known_show_id(input: &str) -> Option<String> {
    let normalized = if input.trim().starts_with("http") { input.trim().to_string() } else { format!("https://{}", input.trim()) };
    if let Some(id) = qiaomu::rss_source_id(&normalized) { return Some(short_hash(&qiaomu::rss_feed_url(&id), 16)); }
    if let Some(id) = qiaomu::site_id(&normalized) { return Some(short_hash(&qiaomu::feed_url(&id), 16)); }
    Some(short_hash(input.trim(), 16))
}

/// A channel page from what was saved last time, so it opens instantly; the page then refreshes it in the background.
#[tauri::command]
fn cached_show(state: State<'_, AppState>, input: String) -> Res<Option<Preview>> {
    let Some(id) = known_show_id(&input) else { return Ok(None) };
    let conn = state.db.lock().unwrap();
    let Some(json) = db::get_blob(&conn, &id, "show-json").map_err(e)? else { return Ok(None) };
    let Ok(show) = serde_json::from_str::<Show>(&json) else { return Ok(None) };
    let fetched_at = db::get_blob(&conn, &id, "fetched-at").map_err(e)?.and_then(|t| t.parse().ok()).unwrap_or(0);
    let episodes = db::list_episodes(&conn, Some(&id), 300).map_err(e)?;
    if episodes.is_empty() { return Ok(None); }
    Ok(Some(Preview { show, episodes, fetched_at }))
}

/// A channel page before subscribing: its episodes are saved (so they can be opened and played) but the show is
/// not, so it stays out of the sidebar and the home feed until the user subscribes.
#[tauri::command]
async fn preview_show(state: State<'_, AppState>, input: String) -> Res<Preview> {
    match fetch_input(&state, &input).await? {
        Fetched::Single(_) => Err("这是单集链接，不是频道".into()),
        Fetched::Show(show, eps) => {
            let mut conn = state.db.lock().unwrap();
            db::upsert_episodes(&mut conn, &eps).map_err(e)?;
            let now = now_ms();
            if let Ok(json) = serde_json::to_string(&show) { let _ = db::set_blob(&conn, &show.id, "show-json", &json); }
            let _ = db::set_blob(&conn, &show.id, "fetched-at", &now.to_string());
            let episodes = db::list_episodes(&conn, Some(&show.id), 300).map_err(e)?;
            Ok(Preview { show, episodes, fetched_at: now })
        }
    }
}

#[tauri::command]
async fn refresh_show(state: State<'_, AppState>, id: String) -> Res<Show> {
    let show = db::get_show(&state.db.lock().unwrap(), &id).map_err(e)?.ok_or("节目不存在")?;
    let (fresh, eps) = fetch_any(&state, &show.feed_url, &show.kind).await.map_err(e)?;
    let fresh = Show { id: show.id.clone(), kind: show.kind.clone(), ..fresh };
    store(&state, &fresh, &eps)?;
    Ok(fresh)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Refreshed { shows: usize, new_episodes: usize, skipped: bool }

static REFRESHING: AtomicBool = AtomicBool::new(false);

/// Checks every subscription for new episodes. Runs at launch and periodically; overlapping calls are skipped.
#[tauri::command]
async fn refresh_all(state: State<'_, AppState>) -> Res<Refreshed> {
    if REFRESHING.swap(true, Ordering::SeqCst) { return Ok(Refreshed { shows: 0, new_episodes: 0, skipped: true }); }
    let r = async {
        let shows: Vec<Show> = db::list_shows(&state.db.lock().unwrap()).map_err(e)?.into_iter().filter(|s| s.kind != "single").collect();
        let (mut ok, mut fresh_eps) = (0, 0);
        for chunk in shows.chunks(6) {
            let results = futures_util::future::join_all(chunk.iter().map(|s| fetch_any(&state, &s.feed_url, &s.kind))).await;
            for (s, r) in chunk.iter().zip(results) {
                let Ok((fresh, eps)) = r else { continue };
                let known = {
                    let conn = state.db.lock().unwrap();
                    eps.iter().filter(|x| conn.query_row("SELECT 1 FROM episodes WHERE id=?1", [&x.id], |_| Ok(())).is_ok()).count()
                };
                let fresh = Show { id: s.id.clone(), kind: s.kind.clone(), ..fresh };
                if store(&state, &fresh, &eps).is_ok() { ok += 1; fresh_eps += eps.len() - known; }
            }
        }
        Ok(Refreshed { shows: ok, new_episodes: fresh_eps, skipped: false })
    }.await;
    REFRESHING.store(false, Ordering::SeqCst);
    r
}

#[tauri::command]
fn list_shows(state: State<'_, AppState>) -> Res<Vec<Show>> { db::list_shows(&state.db.lock().unwrap()).map_err(e) }

#[tauri::command]
fn list_episodes(state: State<'_, AppState>, show_id: Option<String>, limit: Option<i64>) -> Res<Vec<Episode>> {
    db::list_episodes(&state.db.lock().unwrap(), show_id.as_deref(), limit.unwrap_or(300)).map_err(e)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowHit {
    episode: Episode,
    /// title | notes | transcript
    field: &'static str,
    snippet: String,
    /// Where in the episode a subtitle hit is, in seconds.
    time: Option<f64>,
}

/// Searches one show's episodes on this computer: titles (and their Chinese translations), show notes, and the
/// subtitles of episodes that have them, original and Chinese. Every word must appear in the same field.
#[tauri::command]
fn search_show(state: State<'_, AppState>, show_id: String, query: String) -> Res<Vec<ShowHit>> {
    search_episodes(&state.db.lock().unwrap(), &show_id, &query).map_err(e)
}

fn search_episodes(conn: &Connection, show_id: &str, query: &str) -> anyhow::Result<Vec<ShowHit>> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() { return Ok(vec![]); }
    let eps = db::list_episodes(conn, Some(show_id), 5000)?;
    let tags = regex::Regex::new(r"<[^>]+>").unwrap();
    let has = |text: &str| { let l = text.to_lowercase(); words.iter().all(|w| l.contains(w)) };
    let mut hits = Vec::new();
    for ep in eps {
        let zh_title = db::tr_get(conn, &short_hash(&format!("zh-CN|{}", ep.title), 24)).ok().flatten();
        let title = match &zh_title { Some(z) => format!("{} {z}", ep.title), None => ep.title.clone() };
        if has(&title) { hits.push(ShowHit { snippet: String::new(), field: "title", time: None, episode: ep }); continue; }
        let notes = ep.notes.as_deref().map(|n| tags.replace_all(n, " ").to_string()).unwrap_or_default();
        if has(&notes) { hits.push(ShowHit { snippet: snippet(&notes, &words[0]), field: "notes", time: None, episode: ep }); continue; }
        if !ep.has_transcript { continue; }
        let Some(t) = db::get_transcript(conn, &ep.id).ok().flatten() else { continue };
        let zh: Vec<Option<String>> = db::get_blob(conn, &ep.id, "zh").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        // A line matches with its translation; the first one that contains every word is shown.
        let found = t.segments.iter().enumerate().find_map(|(i, s)| {
            let line = match zh.get(i).cloned().flatten() { Some(z) => format!("{} {z}", s.text), None => s.text.clone() };
            has(&line).then(|| (s.start, line))
        });
        if let Some((start, line)) = found { hits.push(ShowHit { snippet: snippet(&line, &words[0]), field: "transcript", time: Some(start), episode: ep }); }
    }
    // Titles first, then show notes, then subtitles; newest first within each (the list is already newest first).
    hits.sort_by_key(|h| match h.field { "title" => 0, "notes" => 1, _ => 2 });
    Ok(hits)
}

/// About 70 characters around the first match.
fn snippet(text: &str, word: &str) -> String {
    let chars: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let lower: String = chars.iter().collect::<String>().to_lowercase();
    let at = lower.find(word).map(|b| lower[..b].chars().count()).unwrap_or(0);
    let from = at.saturating_sub(25);
    let to = (at + 45).min(chars.len());
    format!("{}{}{}", if from > 0 { "…" } else { "" }, chars[from..to].iter().collect::<String>(), if to < chars.len() { "…" } else { "" })
}

#[tauri::command]
fn recent_episodes(state: State<'_, AppState>) -> Res<Vec<Episode>> { db::recent_episodes(&state.db.lock().unwrap(), 60).map_err(e) }

#[tauri::command]
fn get_episode(state: State<'_, AppState>, id: String) -> Res<Option<Episode>> { db::get_episode(&state.db.lock().unwrap(), &id).map_err(e) }

#[tauri::command]
fn remove_show(state: State<'_, AppState>, id: String) -> Res<()> { db::delete_show(&state.db.lock().unwrap(), &id).map_err(e) }

#[tauri::command]
fn set_progress(state: State<'_, AppState>, id: String, seconds: f64) -> Res<()> {
    db::set_progress(&state.db.lock().unwrap(), &id, seconds).map_err(e)?;
    if seconds > 0.0 { offline::renew_cache(&state.data, &id); }
    Ok(())
}

#[tauri::command]
async fn search_podcasts(term: String, country: Option<String>) -> Res<Vec<feeds::SearchResult>> {
    feeds::search_podcasts(&term, country.as_deref().unwrap_or("US")).await.map_err(e)
}

// ---- transcripts -----------------------------------------------------------------------------------

#[tauri::command]
fn load_transcript(state: State<'_, AppState>, episode_id: String) -> Res<Option<Transcript>> {
    db::get_transcript(&state.db.lock().unwrap(), &episode_id).map_err(e)
}

/// One YouTube caption track as a transcript. When the video is not in Chinese and the publisher uploaded
/// Chinese subtitles, those become the translation (blob "zh", engine "youtube") instead of machine translation.
async fn youtube_transcript(state: &AppState, ep: &Episode, info: &youtube::VideoInfo, track: &youtube::Track) -> anyhow::Result<Transcript> {
    let segs = transcript::resegment(transcript::clean(youtube::fetch_track(track).await?));
    let t = Transcript { episode_id: ep.id.clone(), source: if track.auto { "youtube-auto" } else { "youtube" }.into(), language: track.language.clone(), segments: segs };
    if t.segments.is_empty() { return Ok(t); }
    db::save_transcript(&state.db.lock().unwrap(), &t)?;
    if let Some(zh) = youtube::official_chinese(&info.tracks, &track.language) {
        if let Ok(lines) = youtube::fetch_track(zh).await {
            let items = youtube::align(&t.segments, &transcript::clean(lines));
            // Mostly covered, or the tracks are timed too differently to pair up; gaps get machine translation.
            if items.iter().filter(|x| x.is_some()).count() * 10 >= items.len() * 6 {
                let conn = state.db.lock().unwrap();
                db::set_blob(&conn, &ep.id, "zh", &serde_json::to_string(&items)?)?;
                db::set_blob(&conn, &ep.id, "zh-engine", "youtube")?;
            }
        }
    }
    Ok(t)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackChoice { language: String, auto: bool }

/// The caption tracks a video offers, for switching the subtitle language. Auto tracks only in languages
/// with no uploaded track (YouTube's automatic ones are worse when a human one exists).
#[tauri::command]
async fn youtube_tracks(state: State<'_, AppState>, episode_id: String) -> Res<Vec<TrackChoice>> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let Some(vid) = &ep.video_id else { return Ok(vec![]) };
    let info = youtube::video_info(vid).await.map_err(e)?;
    let mut out: Vec<TrackChoice> = Vec::new();
    for t in info.tracks.iter().filter(|t| !t.auto).chain(info.tracks.iter().filter(|t| t.auto)) {
        if !out.iter().any(|c| c.language == t.language) { out.push(TrackChoice { language: t.language.clone(), auto: t.auto }); }
    }
    Ok(out)
}

/// Replaces the transcript with another YouTube caption track.
#[tauri::command]
async fn use_youtube_track(state: State<'_, AppState>, episode_id: String, language: String, auto: bool) -> Res<Transcript> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let vid = ep.video_id.clone().ok_or("不是视频节目")?;
    let info = youtube::video_info(&vid).await.map_err(e)?;
    let track = info.tracks.iter().find(|t| t.language == language && t.auto == auto).ok_or("没有这个语言的字幕")?.clone();
    let t = youtube_transcript(&state, &ep, &info, &track).await.map_err(e)?;
    if t.segments.is_empty() { return Err("这条字幕是空的".into()); }
    // The listener's own choice: never replaced by the automatic pick when the episode opens again.
    db::set_blob(&state.db.lock().unwrap(), &episode_id, "track-picked", "1").map_err(e)?;
    Ok(t)
}

/// The publisher's own subtitles: YouTube captions, or a feed's <podcast:transcript>. None when there are none.
#[tauri::command]
async fn fetch_official_transcript(state: State<'_, AppState>, episode_id: String) -> Res<Option<Transcript>> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let mut youtube_error = None;
    if let Some(vid) = &ep.video_id {
        let published = async {
            let info = youtube::video_info(vid).await?;
            let hint = youtube::script_hint(&info.title).or_else(|| youtube::script_hint(&ep.title));
            if let Some(track) = youtube::choose(&info.tracks, info.original_language.as_deref(), hint) {
                let t = youtube_transcript(&state, &ep, &info, track).await?;
                if !t.segments.is_empty() { return Ok(Some(t)); }
            }
            Ok::<_, anyhow::Error>(None)
        };
        match tokio::time::timeout(std::time::Duration::from_secs(35), published).await {
            Ok(Ok(Some(t))) => return Ok(Some(t)),
            Ok(Ok(None)) => (),
            Ok(Err(error)) => youtube_error = Some(e(error)),
            Err(_) => youtube_error = Some("字幕下载失败".to_owned()),
        }
    }
    let t = if let Some(url) = ep.transcript_url.as_ref().filter(|_| ep.transcript_type.as_deref() != Some("podscribe")) {
        let body = net::get_text(url).await.map_err(e)?;
        let kind = ep.transcript_type.clone().unwrap_or_default();
        let segs = if kind.contains("json") { transcript::parse_podcast_json(&body) } else { transcript::parse_cues(&body) };
        let segs = transcript::resegment(transcript::clean(segs));
        (!segs.is_empty()).then(|| Transcript { episode_id: ep.id.clone(), source: "rss".into(), language: "auto".into(), segments: segs })
    } else {
        None
    };
    // 乔木精读 episodes carry the original transcript on their page (untimed; spread across the episode).
    let t = match t {
        Some(t) => Some(t),
        None if ep.transcript_type.as_deref() == Some("podscribe") && ep.transcript_url.is_some() => {
            let segs = qiaomu::podscribe_transcript(ep.transcript_url.as_ref().unwrap()).await.map_err(e)?;
            (!segs.is_empty()).then(|| Transcript { episode_id: ep.id.clone(), source: "podscribe".into(), language: "en".into(), segments: transcript::resegment(segs) })
        }
        None if ep.transcript_type.as_deref() == Some("qiaomu") => match &ep.link {
            Some(link) => {
                let d = qiaomu::detail(link).await.map_err(e)?;
                d.transcript.map(|text| Transcript { episode_id: ep.id.clone(), source: "qiaomu".into(), language: "auto".into(), segments: qiaomu::transcript_segments(&text, ep.duration.unwrap_or(3600.0)) })
            }
            None => None,
        },
        None => None,
    };
    if let Some(t) = &t {
        if t.segments.is_empty() { return Ok(None); }
        db::save_transcript(&state.db.lock().unwrap(), t).map_err(e)?;
    }
    if t.is_none() { if let Some(error) = youtube_error { return Err(error); } }
    Ok(t)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AsrEvent { episode_id: String, stage: String, progress: f64, message: Option<String>, segment: Option<Segment> }

fn asr_emit(app: &AppHandle, id: &str, stage: &str, progress: f64, message: Option<String>, segment: Option<Segment>) {
    let _ = app.emit("asr", AsrEvent { episode_id: id.into(), stage: stage.into(), progress, message, segment });
}

/// A 乔木精读 episode's page: fills in its audio address and keeps the Chinese deep-read.
#[tauri::command]
async fn qiaomu_detail(state: State<'_, AppState>, episode_id: String) -> Res<qiaomu::Detail> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let d = if matches!(ep.transcript_type.as_deref(), Some("qiaomu-rss") | Some("podscribe")) {
        qiaomu::Detail { audio: None, deep_read: qiaomu::rss_rewrite(&ep.guid).await.map_err(e)?, transcript: None }
    } else {
        let link = ep.link.clone().ok_or("这集没有网页")?;
        qiaomu::detail(&link).await.map_err(e)?
    };
    let conn = state.db.lock().unwrap();
    if let (Some(a), None) = (&d.audio, &ep.audio_url) { let _ = db::set_audio_url(&conn, &ep.id, a); }
    if let Some(h) = &d.deep_read { let _ = db::set_blob(&conn, &ep.id, "deep-read", h); }
    Ok(qiaomu::Detail { transcript: None, ..d })
}

/// Saves a generated image (a quote poster) into the app's Documents folder (iOS: visible in the Files app) and
/// returns its path; the page then offers it to the system share sheet.
#[tauri::command]
fn save_image(app: AppHandle, name: String, base64: String) -> Res<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim_start_matches("data:image/png;base64,")).map_err(e)?;
    // Android has no app Documents folder in Tauri's resolver: the app's own data folder (shared via FileProvider).
    let dir = app.path().document_dir().or_else(|_| app.path().app_data_dir()).map_err(e)?.join("SubCast");
    std::fs::create_dir_all(&dir).map_err(e)?;
    let safe: String = name.chars().filter(|c| !"/\\:*?\"<>|".contains(*c)).take(60).collect();
    let mut path = dir.join(format!("{safe}.png"));
    let mut i = 2;
    while path.exists() { path = dir.join(format!("{safe} {i}.png")); i += 1; }
    std::fs::write(&path, bytes).map_err(e)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn list_models(provider: llm::Provider) -> Res<Vec<String>> { cloud::list_models(&provider).await.map_err(e) }

/// Doubao TTS: a base64 WAV for up to 1,000 characters.
#[tauri::command]
async fn tts_speak(text: String, voice: String, resource: Option<String>) -> Res<String> {
    use base64::Engine;
    let wav = cloud::tts(&voice, resource.as_deref().unwrap_or(""), &text).await.map_err(e)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(wav))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoStream { url: String, /** hls | mp4 */ kind: &'static str }

/// Serves the interface on localhost:LOCAL_PORT (what tauri-plugin-localhost did), from the active hot update when
/// there is one.
#[cfg(not(debug_assertions))]
fn serve_ui(app: &AppHandle, active: ota::Active) {
    let resolver = app.asset_resolver();
    std::thread::spawn(move || {
        let Ok(server) = tiny_http::Server::http(format!("localhost:{LOCAL_PORT}")) else { return };
        for req in server.incoming_requests() {
            let path = req.url().split(['?', '#']).next().unwrap_or("/").to_string();
            let found = match ota::read(&active, &path) {
                Some(file) => file.map(|(bytes, mime)| (bytes, mime.to_string(), None)),
                None => resolver.get(path).map(|a| (a.bytes, a.mime_type, a.csp_header)),
            };
            let Some((bytes, mime, csp)) = found else { let _ = req.respond(tiny_http::Response::empty(404)); continue };
            let mut resp = tiny_http::Response::from_data(bytes);
            for (k, v) in [("Content-Type", Some(mime)), ("Cache-Control", Some("no-cache".to_string())), ("Content-Security-Policy", csp)] {
                if let Some(h) = v.and_then(|v| tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).ok()) { resp.add_header(h); }
            }
            let _ = req.respond(resp);
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UiInfo { shell: &'static str, build: Option<u64> }

/// The page rendered: a hot update being tried becomes the known-good one.
#[tauri::command]
fn ui_ready(state: State<'_, AppState>) -> UiInfo {
    UiInfo { shell: ota::SHELL, build: if cfg!(debug_assertions) { None } else { ota::ready(&state.data) } }
}

/// Remote config (https://subcast.qiaomu.ai/tools/config.json): values that go stale outside our control, such as
/// the YouTube client versions captions depend on. Signed like updates; the last good copy is kept in settings
/// and applied at startup, so the app works offline and a bad fetch changes nothing.
const CONFIG_URL: &str = "https://subcast.qiaomu.ai/tools/config.json";

fn apply_config(v: &Value) {
    youtube::set_clients(&v["youtubeClients"]);
}

#[tauri::command]
async fn refresh_config(app: AppHandle, state: State<'_, AppState>) -> Res<()> {
    // The "updater" entry in tauri.conf.json is kept only for this public key (signed remote config); phones have no updater.
    let pubkey = app.config().plugins.0.get("updater").and_then(|u| u["pubkey"].as_str()).ok_or("缺少更新公钥")?.to_string();
    let body = net::client().get(CONFIG_URL).send().await.map_err(e)?.error_for_status().map_err(e)?.bytes().await.map_err(e)?;
    let sig = net::get_text(&format!("{CONFIG_URL}.sig")).await.map_err(e)?;
    ota::verify(&pubkey, &body, &sig).map_err(e)?;
    let v: Value = serde_json::from_slice(&body).map_err(e)?;
    apply_config(&v);
    db::set_setting(&state.db.lock().unwrap(), "remote-config", &v.to_string()).map_err(e)?;
    Ok(())
}


/// A direct stream for a video the embedded player can't play, straight from InnerTube (phones have no yt-dlp).
/// `mode`: "native-hls" / "proxy-hls" (HLS; the proxy adds the headers googlevideo wants) or "mp4".
#[tauri::command]
async fn youtube_stream(app: AppHandle, state: State<'_, AppState>, video_id: String, mode: Option<String>, fresh: Option<bool>) -> Res<VideoStream> {
    asr::streams::init(&state.data);
    let mode = mode.unwrap_or_else(|| if cfg!(target_os = "ios") { "native-hls".into() } else { "mp4".into() });
    let key = format!("{video_id}|{mode}");
    let _ = app.emit("yt-stream", json!({ "videoId": video_id, "stage": "resolve", "progress": 0.0 }));
    // A direct address may require the issuing client's User-Agent or the user's in-app proxy.
    // WebKit cannot set those headers. The loopback route retains them for every range and HLS segment.
    let relay = mode == "relay" || mode == "proxy-hls" || !net::proxy().is_empty();
    let cached = if relay || fresh.unwrap_or(false) { None } else { asr::streams::get(&key) };
    let (url, agent) = match cached {
        Some(url) => (url, String::new()),
        None => {
            let purpose = if mode == "mp4" { youtube::StreamUse::Mp4 } else { youtube::StreamUse::Video };
            let s = tokio::time::timeout(std::time::Duration::from_secs(12), youtube::streams(&video_id, purpose)).await
                .map_err(|_| "获取视频地址超时，请检查网络或代理".to_string())?.map_err(e)?;
            let url = match mode.as_str() {
                "mp4" => s.mp4,
                "relay" => s.mp4.or(s.hls),
                _ => s.hls.or(s.mp4),
            }.ok_or("这个视频没有可直接播放的地址")?;
            if !relay { asr::streams::put(&key, &url); }
            (url, s.ua)
        }
    };
    let is_hls = url.contains("m3u8") || url.contains("/manifest/hls");
    let url = if relay { hlsproxy::proxied(&url, &agent).await.map_err(e)? } else { url };
    Ok(VideoStream { url, kind: if is_hls { "hls" } else { "mp4" } })
}

/// Nothing to prepare on a phone (no yt-dlp); kept so the page's call is harmless.
#[tauri::command]
async fn prepare_youtube() -> Res<()> { Ok(()) }

// ---- offline -------------------------------------------------------------------------------------------

#[tauri::command]
async fn download_episode(app: AppHandle, state: State<'_, AppState>, episode_id: String) -> Res<offline::Saved> {
    if let Some(s) = offline::find(&state.data, &episode_id) { return Ok(s); }
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let job = format!("dl:{episode_id}");
    let cancel = state.job(&job);
    let id = episode_id.clone();
    let result = offline::download(&state.data, &ep, cancel, |p| { let _ = app.emit("offline", json!({ "episodeId": id, "progress": p })); }).await.map_err(e);
    state.done(&job);
    result
}

#[tauri::command]
fn list_downloads(state: State<'_, AppState>) -> Vec<offline::Saved> { offline::list(&state.data) }

#[tauri::command]
fn delete_download(state: State<'_, AppState>, episode_id: String) -> Res<()> { offline::remove(&state.data, &episode_id).map_err(e) }

#[tauri::command]
fn clear_downloads(state: State<'_, AppState>) -> Res<()> { offline::clear(&state.data).map_err(e) }

fn dir_bytes(p: &std::path::Path) -> u64 {
    std::fs::read_dir(p).map(|rd| rd.flatten().map(|f| match f.metadata() {
        Ok(m) if m.is_dir() => dir_bytes(&f.path()),
        Ok(m) => m.len(),
        Err(_) => 0,
    }).sum()).unwrap_or(0)
}

/// The full show notes when the feed only carried a short summary (rss.qiaomu.ai channels cut it at
/// ~300 characters): the YouTube description when the episode has a video (chapters and links), else
/// the 小宇宙 shownotes. Kept in the "notes-full" blob, so each episode is fetched once.
#[tauri::command]
async fn full_notes(state: State<'_, AppState>, episode_id: String) -> Res<Option<String>> {
    if let Some(cached) = db::get_blob(&state.db.lock().unwrap(), &episode_id, "notes-full").map_err(e)? { return Ok(Some(cached).filter(|s| !s.is_empty())); }
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let have = ep.notes.as_deref().map(|n| n.chars().count()).unwrap_or(0);
    let mut best: Option<String> = None;
    let mut reached = false;
    if let Some(v) = &ep.video_id {
        if let Ok(info) = youtube::video_info(v).await { reached = true; if !info.description.trim().is_empty() { best = Some(info.description); } }
    }
    if let Some(link) = ep.link.as_deref().filter(|l| l.contains("xiaoyuzhoufm.com/episode/")) {
        if let Ok(x) = feeds::xiaoyuzhou_episode(link).await {
            reached = true;
            if let Some(n) = x.notes { if best.as_ref().map_or(true, |b| n.chars().count() > b.chars().count()) { best = Some(n); } }
        }
    }
    // Only keep it when it really is longer; "" marks "checked, nothing better" so we don't ask again.
    let out = best.filter(|b| b.chars().count() > have + 40);
    if out.is_none() && !reached { return Ok(None); } // offline or blocked: try again next time
    db::set_blob(&state.db.lock().unwrap(), &episode_id, "notes-full", out.as_deref().unwrap_or("")).map_err(e)?;
    Ok(out)
}

/// What SubCast keeps on disk, for the storage section of Settings.
#[tauri::command]
fn storage_info(state: State<'_, AppState>) -> serde_json::Value {
    let d = &state.data;
    let library: u64 = ["subcast.db", "subcast.db-wal", "subcast.db-shm"].iter().map(|f| std::fs::metadata(d.join(f)).map(|m| m.len()).unwrap_or(0)).sum();
    json!({
        "downloads": dir_bytes(&offline::dir(d)),
        "models": 0,
        "library": library,
        "temp": dir_bytes(&d.join("work")),
    })
}

/// Removes leftovers of interrupted transcriptions.
#[tauri::command]
fn clear_temp(state: State<'_, AppState>) -> Res<()> {
    let dir = state.data.join("work");
    if dir.exists() { std::fs::remove_dir_all(&dir).map_err(e)?; }
    Ok(())
}

/// Someone else's subtitles for this episode from the shared library, saved as this episode's transcript (and
/// their Chinese as its translation). None when the library hasn't got it.
async fn take_shared(state: &AppState, ep: &Episode) -> Option<Transcript> {
    let mut hit = shared::lookup(&shared::keys(ep)).await?;
    let translation = hit.translation.take();
    let t = shared::into_transcript(&ep.id, hit);
    db::save_transcript(&state.db.lock().unwrap(), &t).ok()?;
    // The shared Chinese lines become this episode's translation (engine "shared"); the subtitle view only
    // machine-translates the gaps. Saved after the transcript, which clears an episode's old blobs.
    if let Some(tr) = translation.filter(|tr| tr.items.len() == t.segments.len() && tr.lang.starts_with("zh")) {
        let conn = state.db.lock().unwrap();
        let _ = db::set_blob(&conn, &ep.id, "zh", &serde_json::to_string(&tr.items).unwrap_or_default());
        let _ = db::set_blob(&conn, &ep.id, "zh-engine", "shared");
    }
    Some(t)
}

/// Checked when an episode opens, before it is called "no subtitles", so no model is downloaded for it.
#[tauri::command]
async fn shared_transcript(state: State<'_, AppState>, episode_id: String) -> Res<Option<Transcript>> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    Ok(take_shared(&state, &ep).await)
}

/// The episodes (of these ids) someone already shared subtitles for, so lists can mark and sort them.
#[tauri::command]
async fn shared_exists(state: State<'_, AppState>, episode_ids: Vec<String>) -> Res<Vec<String>> {
    let eps: Vec<Episode> = {
        let conn = state.db.lock().unwrap();
        episode_ids.iter().take(200).filter_map(|id| db::get_episode(&conn, id).ok().flatten()).collect()
    };
    let lists: Vec<Vec<String>> = eps.iter().map(shared::keys).collect();
    let hits = shared::existing(&lists).await;
    Ok(eps.into_iter().zip(hits).filter(|(_, h)| *h).map(|(ep, _)| ep.id).collect())
}

#[tauri::command]
async fn transcribe(app: AppHandle, state: State<'_, AppState>, episode_id: String, model: String, language: String, cloud: Option<cloud::CloudAsr>) -> Res<Transcript> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    // Someone else may have shared this episode's subtitles; a hit skips the download + ASR pass
    // entirely (and works even without a local model).
    let share_keys = shared::keys(&ep);
    if let Some(t) = take_shared(&state, &ep).await {
        asr_emit(&app, &episode_id, "done", 1.0, None, None);
        return Ok(t);
    }
    let _ = model; // phones have no local recogniser: every transcription is a cloud one
    if cloud.is_none() { return Err("请先在 设置 › 字幕 里选一个云端识别服务并填好 Key".into()); }
    let cancel = state.job(&episode_id);
    let work = state.data.join("work").join(&episode_id);
    let result = async {
        let _ = tokio::fs::create_dir_all(&work).await;
        asr_emit(&app, &episode_id, "download", 0.0, None, None);
        let audio = if let Some(saved) = offline::find(&state.data, &episode_id) {
            PathBuf::from(saved.path)
        } else if let Some(vid) = &ep.video_id {
            let s = youtube::streams(vid, youtube::StreamUse::Audio).await.map_err(e)?;
            let url = s.audio.ok_or("YouTube 没有给出这个视频的音频地址")?;
            let dest = work.join("audio.m4a");
            let (app2, id2) = (app.clone(), episode_id.clone());
            youtube::download_stream(&url, &s.ua, &dest, &cancel, move |got, total| {
                asr_emit(&app2, &id2, "download", total.map(|t| got as f64 / t.max(1) as f64).unwrap_or(0.0), None, None);
            }).await.map_err(e)?;
            dest
        } else {
            let url = ep.audio_url.clone().ok_or("这集没有音频地址")?;
            let dest = work.join(format!("audio.{}", offline::audio_ext(&url)));
            let app2 = app.clone();
            let id2 = episode_id.clone();
            asr::download(&url, &dest, &cancel, move |got, total| {
                let p = total.map(|t| got as f64 / t as f64).unwrap_or(0.0);
                asr_emit(&app2, &id2, "download", p, None, None);
            }).await.map_err(e)?;
            dest
        };
        asr_emit(&app, &episode_id, "transcribe", 0.0, None, None);
        // What the episode says about itself helps spell names and terms (asr_context.rs). The "useShowNotes"
        // setting (default on) can turn it off; it is dropped when its script doesn't match the spoken language.
        let use_notes = {
            let conn = state.db.lock().unwrap();
            db::get_setting(&conn, "app").ok().flatten().and_then(|r| serde_json::from_str::<Value>(&r).ok())
                .and_then(|s| s["useShowNotes"].as_bool()).unwrap_or(true)
        };
        let meta = if use_notes {
            asr_context::Meta { title: ep.title.clone(), show: ep.show_title.clone().unwrap_or_default(), description: ep.notes.clone().unwrap_or_default(), chapters: vec![] }
        } else { asr_context::Meta::default() };
        let hotwords: Vec<String> = if use_notes { db::get_blob(&state.db.lock().unwrap(), &ep.id, "ctx").ok().flatten()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(|v| v["terms"].as_array().into_iter().flatten().filter_map(|t| t["src"].as_str().map(str::to_string)).collect()).unwrap_or_default() } else { vec![] };
        let lang_for = |text: &str| if language == "auto" { asr_context::script_of(&format!("{} {}", ep.title, text)) } else { language.as_str() };
        let fit = |text: String| if asr_context::fits_language(&text, lang_for(&text)) && (language != "auto" || asr_context::script_of(&ep.title) == asr_context::script_of(&text)) { text } else { String::new() };
        let ctx = asr::AsrContext {
            prompt: fit(asr_context::prompt(&meta, asr_context::BUDGET_PROMPT)),
            background: fit(asr_context::background(&meta, asr_context::BUDGET_QWEN)),
            doubao: { let b = fit(asr_context::background(&meta, asr_context::BUDGET_DOUBAO)); if b.is_empty() && hotwords.is_empty() { String::new() } else { asr_context::doubao(&asr_context::Meta { description: b, ..Default::default() }, &hotwords) } },
            hotwords: hotwords.clone(),
        };
        let app2 = app.clone();
        let id2 = episode_id.clone();
        let out = if let Some(cfg) = &cloud {
            asr_emit(&app, &episode_id, "transcribe", 0.01, Some("正在解码音频".into()), None);
            let src = audio.clone();
            let samples = tokio::task::spawn_blocking(move || asr::decode_16k_mono(&src)).await.map_err(e)?.map_err(e)?;
            let segments = cloud::transcribe(cfg, samples, &language, &ctx, cancel.clone(), move |p| asr_emit(&app2, &id2, "transcribe", p, Some("云端识别中".into()), None)).await.map_err(e)?;
            let sample: String = segments.iter().take(5).map(|s| s.text.as_str()).collect();
            let lang = if language != "auto" { language.clone() } else if sample.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)) { "zh".into() } else { "auto".into() };
            asr::WorkerResult { language: lang, segments }
        } else { unreachable!() };
        // A recogniser can echo its background on silence or music: such cues are the prompt, not speech.
        let echo_of = format!("{} {} {}", ctx.background, ctx.prompt, ctx.doubao);
        let heard: Vec<Segment> = out.segments.into_iter().filter(|s| !asr_context::is_echo(&s.text, &echo_of)).collect();
        let segments = transcript::resegment(transcript::clean(heard));
        if segments.is_empty() { return Err("没有识别出文字（可能是纯音乐或静音）".to_string()); }
        let t = Transcript { episode_id: ep.id.clone(), source: "cloud".into(), language: out.language, segments };
        db::save_transcript(&state.db.lock().unwrap(), &t).map_err(e)?;
        // What made it, for sharing the translation later (share_translation).
        let made_by = json!({ "source": "cloud",
            "model": cloud.as_ref().map(|c| c.model.clone()).unwrap_or_default() });
        let _ = db::set_blob(&state.db.lock().unwrap(), &ep.id, "asr-meta", &made_by.to_string());
        Ok(t)
    }.await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    state.done(&episode_id);
    // Share what we just made, so the next person listening to this episode skips transcribing.
    if let (Ok(t), false) = (&result, share_keys.is_empty()) {
        let (share_on, install) = {
            let conn = state.db.lock().unwrap();
            let on = db::get_setting(&conn, "app").ok().flatten()
                .and_then(|r| serde_json::from_str::<Value>(&r).ok())
                .and_then(|s| s["shareTranscripts"].as_bool()).unwrap_or(true);
            (on, install_id(&conn))
        };
        if share_on {
            let last_end = t.segments.last().map(|s| s.end).unwrap_or(0.0);
            let translation = {
                let conn = state.db.lock().unwrap();
                let items: Vec<Option<String>> = t.segments.iter().map(|s| db::tr_get(&conn, &short_hash(&format!("zh-CN|{}", s.text), 24)).ok().flatten()).collect();
                let filled = items.iter().filter(|i| i.is_some()).count();
                (filled * 5 >= items.len() * 3).then(|| ("zh-CN".to_string(), items))
            };
            let meta = shared::UploadMeta {
                title: ep.title.clone(),
                show: ep.show_title.clone().unwrap_or_default(),
                duration: ep.duration.unwrap_or(0.0).max(last_end).max(1.0),
                source: "cloud".into(),
                model: cloud.as_ref().map(|c| c.model.clone()).unwrap_or_default(),
                language: t.language.clone(),
                install,
                translation,
            };
            let segs = t.segments.clone();
            let app2 = app.clone();
            tokio::spawn(async move {
                if let Ok(action) = shared::upload(&share_keys, meta, &segs).await { let _ = app2.emit("shared-upload", action); }
            });
        }
    }
    match &result {
        Ok(_) => asr_emit(&app, &episode_id, "done", 1.0, None, None),
        Err(m) => asr_emit(&app, &episode_id, "error", 0.0, Some(m.clone()), None),
    }
    result
}

/// A random id for this install; the server stores only a salted hash of it, for vote/report dedupe.
/// Shares an episode's finished Chinese translation with its recognised transcript, so the next listener gets
/// bilingual subtitles at once. Only transcripts the shared library takes (speech recognition, ours or shared)
/// and only with the "shareTranscripts" setting on. `engine`: llm | google. Returns the server's action.
#[tauri::command]
async fn share_translation(state: State<'_, AppState>, episode_id: String, engine: String, model: String) -> Res<String> {
    let (ep, t, items, made_by, share_on, install) = {
        let conn = state.db.lock().unwrap();
        let ep = db::get_episode(&conn, &episode_id).map_err(e)?.ok_or("节目不存在")?;
        let t = db::get_transcript(&conn, &episode_id).map_err(e)?.ok_or("没有字幕")?;
        let items: Vec<Option<String>> = db::get_blob(&conn, &episode_id, "zh").map_err(e)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let made_by = db::get_blob(&conn, &episode_id, "asr-meta").ok().flatten().and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let on = db::get_setting(&conn, "app").ok().flatten().and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .and_then(|s| s["shareTranscripts"].as_bool()).unwrap_or(true);
        (ep, t, items, made_by, on, install_id(&conn))
    };
    if !share_on || !matches!(engine.as_str(), "llm" | "google") { return Ok("skipped".into()); }
    // Shared hits carry their origin in the source ("shared:qwen3"); an unknown model scores lowest, so the
    // server keeps the existing segments and only takes the translation.
    let (source, asr_model) = match (t.source.as_str(), &made_by) {
        ("whisper" | "cloud", Some(m)) => (m["source"].as_str().unwrap_or("whisper").to_string(), m["model"].as_str().unwrap_or("").to_string()),
        (s, _) if s.starts_with("shared:") => (s.trim_start_matches("shared:").to_string(), String::new()),
        _ => return Ok("skipped".into()),
    };
    if !matches!(source.as_str(), "whisper" | "qwen3" | "cloud") || items.len() != t.segments.len() { return Ok("skipped".into()); }
    let filled = items.iter().filter(|i| i.as_ref().is_some_and(|s| !s.is_empty())).count();
    if filled * 10 < items.len() * 9 { return Ok("skipped".into()); }
    let keys = shared::keys(&ep);
    if keys.is_empty() { return Ok("skipped".into()); }
    let meta = shared::UploadMeta {
        title: ep.title.clone(), show: ep.show_title.clone().unwrap_or_default(),
        duration: ep.duration.unwrap_or(0.0).max(t.segments.last().map(|s| s.end).unwrap_or(0.0)).max(1.0),
        source, model: asr_model, language: t.language.clone(), install,
        translation: Some(("zh-CN".to_string(), items)),
    };
    shared::upload_with(&keys, meta, &t.segments, &engine, &model).await.map_err(e)
}

/// A 导读 someone shared for this episode; kept as this episode's own (blob "summary") when found.
#[tauri::command]
async fn shared_guide(state: State<'_, AppState>, episode_id: String) -> Res<Option<String>> {
    let ep = db::get_episode(&state.db.lock().unwrap(), &episode_id).map_err(e)?.ok_or("节目不存在")?;
    let Some(text) = shared::lookup_guide(&shared::keys(&ep)).await else { return Ok(None) };
    let conn = state.db.lock().unwrap();
    let _ = db::set_blob(&conn, &episode_id, "summary", &text);
    let _ = db::set_blob(&conn, &episode_id, "summary-from", "shared");
    Ok(Some(text))
}

/// Shares a 导读 made here, when 「匿名分享」 is on.
#[tauri::command]
async fn share_guide(state: State<'_, AppState>, episode_id: String, text: String, model: String) -> Res<String> {
    let (ep, on, install) = {
        let conn = state.db.lock().unwrap();
        let ep = db::get_episode(&conn, &episode_id).map_err(e)?.ok_or("节目不存在")?;
        let on = db::get_setting(&conn, "app").ok().flatten().and_then(|r| serde_json::from_str::<Value>(&r).ok())
            .and_then(|s| s["shareTranscripts"].as_bool()).unwrap_or(true);
        let _ = db::set_blob(&conn, &episode_id, "summary-from", "");
        (ep, on, install_id(&conn))
    };
    let keys = shared::keys(&ep);
    if !on || keys.is_empty() { return Ok("skipped".into()); }
    shared::upload_guide(&keys, &ep.title, ep.show_title.as_deref().unwrap_or(""), &model, &text, install).await.map_err(e)
}

fn install_id(conn: &Connection) -> String {
    if let Ok(Some(id)) = db::get_setting(conn, "install") { return id; }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = db::set_setting(conn, "install", &id);
    id
}

#[tauri::command]
fn cancel_job(state: State<'_, AppState>, id: String) {
    if let Some(f) = state.jobs.lock().unwrap().get(&id) { f.store(true, Ordering::Relaxed); }
}

/// Listening time from the player (only while playing; seeks don't count).
#[tauri::command]
fn log_listen(state: State<'_, AppState>, episode_id: String, show_id: String, seconds: f64, translated: bool) -> Res<()> {
    db::log_listen(&state.db.lock().unwrap(), &episode_id, &show_id, seconds, translated).map_err(e)
}

#[tauri::command]
fn listening_stats(state: State<'_, AppState>, since: String) -> Res<Vec<Value>> {
    db::listens_since(&state.db.lock().unwrap(), &since).map_err(e)
}

// ---- stored data and settings ------------------------------------------------------------------------

#[tauri::command]
fn get_blob(state: State<'_, AppState>, episode_id: String, kind: String) -> Res<Option<String>> {
    db::get_blob(&state.db.lock().unwrap(), &episode_id, &kind).map_err(e)
}

#[tauri::command]
fn set_blob(state: State<'_, AppState>, episode_id: String, kind: String, data: String) -> Res<()> {
    db::set_blob(&state.db.lock().unwrap(), &episode_id, &kind, &data).map_err(e)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Res<Value> {
    let raw = db::get_setting(&state.db.lock().unwrap(), "app").map_err(e)?;
    Ok(raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or(Value::Null))
}

#[tauri::command]
fn set_settings(state: State<'_, AppState>, settings: Value) -> Res<()> {
    net::set_proxy(settings["proxy"].as_str().unwrap_or("")).map_err(e)?;
    db::set_setting(&state.db.lock().unwrap(), "app", &settings.to_string()).map_err(e)
}

#[tauri::command]
fn set_api_key(provider: String, key: String) -> Res<()> { llm::set_key(&provider, key.trim()).map_err(e) }

#[tauri::command]
fn has_api_key(provider: String) -> bool { llm::get_key(&provider).is_some_and(|k| !k.is_empty()) }

#[tauri::command]
async fn llm_chat(app: AppHandle, state: State<'_, AppState>, request_id: String, provider: llm::Provider, system: String, messages: Vec<llm::Message>, max_tokens: Option<u32>, json_mode: Option<bool>) -> Res<String> {
    let cancel = state.job(&request_id);
    let rid = request_id.clone();
    let r = llm::chat(&provider, &system, &messages, max_tokens.unwrap_or(8000), json_mode.unwrap_or(false), &cancel, |d| {
        let _ = app.emit("llm", json!({"requestId": rid, "delta": d}));
    }).await;
    state.done(&request_id);
    r.map_err(e)
}

/// Every subscription with a feed as an OPML document (the page shares or copies it).
#[tauri::command]
fn export_opml(state: State<'_, AppState>) -> Res<String> {
    let shows = db::list_shows(&state.db.lock().unwrap()).map_err(e)?;
    let list: Vec<(String, String)> = shows.into_iter().filter(|s| s.feed_url.starts_with("http")).map(|s| (s.title, s.feed_url)).collect();
    Ok(import::opml(&list))
}

/// Machine translation (Google, free) with a persistent cache; used for titles, show notes, and subtitles
/// when no model of the user's own is set up.
#[tauri::command]
async fn translate_texts(state: State<'_, AppState>, texts: Vec<String>, target: Option<String>) -> Res<Vec<String>> {
    let tl = target.unwrap_or_else(|| "zh-CN".into());
    let keys: Vec<String> = texts.iter().map(|t| short_hash(&format!("{tl}|{t}"), 24)).collect();
    let mut out: Vec<Option<String>> = {
        let conn = state.db.lock().unwrap();
        keys.iter().map(|k| db::tr_get(&conn, k).ok().flatten()).collect()
    };
    let missing: Vec<usize> = (0..texts.len()).filter(|&i| out[i].is_none() && !texts[i].trim().is_empty()).collect();
    if !missing.is_empty() {
        let lines: Vec<String> = missing.iter().map(|&i| texts[i].clone()).collect();
        let done = translate::translate_lines(&lines, &tl).await.map_err(e)?;
        let conn = state.db.lock().unwrap();
        for (j, &i) in missing.iter().enumerate() {
            if let Some(t) = done.get(j) { let _ = db::tr_put(&conn, &keys[i], t); out[i] = Some(t.clone()); }
        }
    }
    Ok(out.into_iter().map(Option::unwrap_or_default).collect())
}


// ---- app ------------------------------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_mobile::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            offline::prune_cache(&data, std::time::SystemTime::now());
            let conn = db::open(&data.join("subcast.db"))?;
            conn.execute("INSERT OR IGNORE INTO shows(id,kind,title,feed_url,updated_at) VALUES('single','single','单独打开','',0)", [])?;
            if let Some(s) = db::get_setting(&conn, "app")?.and_then(|r| serde_json::from_str::<Value>(&r).ok()) {
                let _ = net::set_proxy(s["proxy"].as_str().unwrap_or(""));
            }
            llm::init_store(&data);
            // Release builds serve the interface over http://localhost (YouTube's embedded player refuses pages
            // from tauri:// or http://tauri.localhost: no valid origin). No hot updates on phones.
            #[cfg(not(debug_assertions))]
            serve_ui(app.handle(), std::sync::Arc::new(std::sync::RwLock::new(None)));
            if let Some(v) = db::get_setting(&conn, "remote-config")?.and_then(|r| serde_json::from_str::<Value>(&r).ok()) { apply_config(&v); }
            app.manage(AppState { db: Mutex::new(conn), data, jobs: Mutex::new(HashMap::new()) });
            #[cfg(debug_assertions)]
            let url = tauri::WebviewUrl::App("index.html".into());
            #[cfg(not(debug_assertions))]
            let url = tauri::WebviewUrl::External(format!("http://localhost:{LOCAL_PORT}").parse().unwrap());
            tauri::WebviewWindowBuilder::new(app, "main", url).build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_subscription, refresh_show, refresh_all, list_shows, list_episodes, recent_episodes, get_episode, remove_show,
            set_progress, search_podcasts, search_show, load_transcript, fetch_official_transcript, transcribe, cancel_job,
            get_blob, set_blob, get_settings, set_settings, set_api_key, has_api_key, llm_chat, translate_texts, shared_transcript, shared_exists, shared_guide, share_guide, log_listen, listening_stats, export_opml, share_translation, ui_ready, refresh_config, youtube_stream, prepare_youtube, youtube_tracks, use_youtube_track, qiaomu_detail, preview_show, list_models, tts_speak, cached_show, save_image,
            download_episode, list_downloads, delete_download, clear_downloads, storage_info, clear_temp, full_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod live {
    //! Network tests against real services: `cargo test -- --ignored --nocapture`.
    use super::*;
    #[tokio::test]
    #[ignore]
    async fn qiaomu_rss_sources() {
        let ids = ["nexttoken", "bannatie", "latentspace", "podscribe-acquired", "podscribe-pivot", "podscribe-freakonomics-radio", "podscribe-invest-like-the-best", "podscribe-the-diary-of-a-ceo-with-steven-bartlett"];
        for id in ids {
            let ch = crate::qiaomu::rss_channel(id).await.unwrap();
            let playable = |x: &Episode| x.audio_url.is_some() || x.video_id.is_some();
            println!("{id}: {} eps={} playable={} video={} deep={} cover={}", ch.show.title, ch.episodes.len(), ch.episodes.iter().filter(|x| playable(x)).count(), ch.episodes.iter().filter(|x| x.video_id.is_some()).count(), ch.episodes.iter().filter(|x| x.deep).count(), ch.show.cover.is_some());
            if id == "nexttoken" { assert!(ch.episodes.iter().filter(|x| x.video_id.is_some()).count() * 2 >= ch.episodes.len(), "nexttoken episodes should mostly have the YouTube video"); }
            assert!(!id.starts_with("podscribe-") || ch.episodes.iter().all(|x| x.transcript_url.is_some()), "{id}: podscribe episodes need a transcript");
            assert!(id.starts_with("podscribe-") || ch.episodes.iter().all(playable), "{id}: unplayable entries should be skipped");
            if id.starts_with("podscribe-") {
                let pool = crate::qiaomu::borrowable(id, &ch.show.title).await;
                for x in ch.episodes.iter().take(6) {
                    let m = crate::qiaomu::find_audio(&pool, &x.title, x.published).map(|b| b.title.chars().take(60).collect::<String>());
                    println!("  {:<62} -> {:?}", x.title.chars().take(60).collect::<String>(), m);
                }
            }
            let Some(e) = ch.episodes.iter().find(|x| x.deep) else { continue };
            let rw = crate::qiaomu::rss_rewrite(&e.guid).await.unwrap();
            assert!(rw.is_some(), "{id}: rewriteReady entry has no rewrite");
            println!("  rewrite={}", rw.as_ref().map(|h| h.chars().take(120).collect::<String>()).unwrap_or_default());
            if let Some(u) = &e.transcript_url { let s = crate::qiaomu::podscribe_transcript(u).await.unwrap(); println!("  segs={} {:?}", s.len(), s.get(1).map(|x| (x.start, x.text.chars().take(40).collect::<String>()))); }
        }
    }
    #[tokio::test]
    #[ignore]
    async fn qiaomu_channels() {
        for id in ["lex", "nopriors", "zhangxiaojun"] {
            let ch = crate::qiaomu::channel(id).await.unwrap();
            let ep = &ch.episodes[0];
            println!("{id}: {} | cover={:?} | eps={} | zh={} | first={} video={:?}", ch.show.title, ch.show.cover, ch.episodes.len(), ch.zh_titles.len(), ep.title, ep.video_id);
            let d = crate::qiaomu::detail(ep.link.as_ref().unwrap()).await.unwrap();
            println!("  audio={:?} deep={} transcript={}", d.audio, d.deep_read.as_ref().map(|h| h.len()).unwrap_or(0), d.transcript.as_ref().map(|t| t.len()).unwrap_or(0));
            if let Some(t) = &d.transcript { let segs = crate::qiaomu::transcript_segments(t, ep.duration.unwrap_or(3600.0)); println!("  segs={} first={:?}", segs.len(), segs.first().map(|s| s.text.chars().take(80).collect::<String>())); }
        }
    }
    #[tokio::test]
    #[ignore]
    async fn sources() {
        for input in ["https://www.youtube.com/@DwarkeshPatel", "https://podcasts.apple.com/us/podcast/no-priors/id1668002688", "https://www.xiaoyuzhoufm.com/podcast/5e5c52c9418a84a04625e6cc", "https://feeds.megaphone.fm/nopriors"] {
            let (show, eps) = match feeds::resolve(input).await.unwrap() {
                feeds::Source::Feed(u) => feeds::fetch_show(&u, "podcast").await.unwrap(),
                feeds::Source::Xiaoyuzhou(u) => feeds::xiaoyuzhou_show(&u).await.unwrap(),
                _ => panic!("unexpected source for {input}"),
            };
            println!("{input} -> {} [{}] {} episodes; first: {:?} audio={:?} video={:?} transcript={:?}", show.title, show.kind, eps.len(), eps[0].title, eps[0].audio_url.is_some(), eps[0].video_id, eps[0].transcript_url);
            assert!(!eps.is_empty());
        }
        let r = feeds::search_podcasts("lex fridman", "US").await.unwrap();
        println!("search: {} results, first {}", r.len(), r[0].title);
    }
    #[tokio::test]
    #[ignore]
    async fn discover_picks() {
        let inputs = [
            "https://www.xiaoyuzhoufm.com/podcast/5e4ee557418a84a0466737b7", "https://www.xiaoyuzhoufm.com/podcast/5e2831ed418a84a046231c00",
            "https://www.xiaoyuzhoufm.com/podcast/5f72b66083c34e85dd14fde9", "https://www.xiaoyuzhoufm.com/podcast/5e4515bd418a84a046e2b11a",
            "https://www.xiaoyuzhoufm.com/podcast/611719d3cb0b82e1df0ad29e", "https://www.xiaoyuzhoufm.com/podcast/6022a180ef5fdaddc30bb101",
            "https://www.xiaoyuzhoufm.com/podcast/61dd99a47b29652ff572257b", "https://www.xiaoyuzhoufm.com/podcast/61358d971c5d56efe5bcb5d2",
            "https://www.xiaoyuzhoufm.com/podcast/5e74b52c418a84a046ecaceb", "https://www.xiaoyuzhoufm.com/podcast/5e280faf418a84a0461fbd39",
            "https://www.xiaoyuzhoufm.com/podcast/646d6bfa53a5e5ea14e69c7c", "https://www.xiaoyuzhoufm.com/podcast/64379296ff8a107611a67208",
            "https://www.xiaoyuzhoufm.com/podcast/6627fda4b56459544087d86a", "https://www.xiaoyuzhoufm.com/podcast/68981df29e7bcd326eb91d88",
            "https://www.xiaoyuzhoufm.com/podcast/5e285856418a84a04627b7be", "https://www.xiaoyuzhoufm.com/podcast/62694abdb221dd5908417d1e",
            "https://www.youtube.com/@hubermanlab", "https://www.youtube.com/@MachineLearningStreetTalk", "https://www.youtube.com/@Bg2Pod",
            "https://www.youtube.com/@MyFirstMillionPod", "https://www.youtube.com/@ChrisWillx", "https://www.youtube.com/@timferriss",
            "https://www.youtube.com/@Alex.kantrowitz", "https://www.youtube.com/@tkppodcast", "https://www.youtube.com/@cheekypint",
            "https://www.youtube.com/@PeterAttiaMD", "https://www.youtube.com/@peterdiamandis", "https://www.youtube.com/@EveryInc",
        ];
        let mut bad = vec![];
        for input in inputs {
            let r = match feeds::resolve(input).await {
                Ok(feeds::Source::Feed(u)) => feeds::fetch_show(&u, "podcast").await,
                Ok(feeds::Source::Xiaoyuzhou(u)) => feeds::xiaoyuzhou_show(&u).await,
                Ok(_) => Err(anyhow::anyhow!("unexpected source")),
                Err(err) => Err(err),
            };
            match r {
                Ok((show, eps)) => {
                    let newest = eps.iter().filter_map(|x| x.published).max().unwrap_or(0);
                    let days = (now_ms() - newest) / 86_400_000;
                    let playable = eps.iter().filter(|x| x.audio_url.is_some() || x.video_id.is_some()).count();
                    println!("{input}\n  -> {} | eps={} playable={} newest={}d ago | cover={:?}", show.title, eps.len(), playable, days, show.cover);
                    if eps.is_empty() || playable == 0 { bad.push(input); }
                }
                Err(err) => { println!("{input}\n  !! {err}"); bad.push(input); }
            }
        }
        assert!(bad.is_empty(), "failed: {bad:?}");
    }
    /// SUBCAST_DB: a copy of a real library. Every transcribed episode in it should come back from the shared library.
    #[tokio::test]
    #[ignore]
    async fn shared_library_hits() {
        let conn = rusqlite::Connection::open(std::env::var("SUBCAST_DB").unwrap()).unwrap();
        let ids: Vec<(String, String)> = conn.prepare("SELECT episode_id, source FROM transcripts WHERE source NOT LIKE 'youtube%'").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
        for (id, source) in ids {
            let Some(ep) = db::get_episode(&conn, &id).unwrap() else { continue };
            let hit = shared::lookup(&shared::keys(&ep)).await;
            println!("{source:>14} {:<40} shared: {}", ep.title.chars().take(40).collect::<String>(),
                hit.map(|h| format!("{} lines, zh {}", h.segments.len(), h.translation.map(|t| t.items.len()).unwrap_or(0))).unwrap_or("none".into()));
        }
    }
    /// SUBCAST_DB: a copy of a real library.
    #[test]
    #[ignore]
    fn search_inside_a_show() {
        let conn = rusqlite::Connection::open(std::env::var("SUBCAST_DB").unwrap()).unwrap();
        let shows: Vec<(String, String)> = conn.prepare("SELECT s.id, s.title FROM shows s WHERE EXISTS(SELECT 1 FROM transcripts t JOIN episodes e ON e.id=t.episode_id WHERE e.show_id=s.id)").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
        for (id, title) in shows.iter().take(4) {
            for q in ["AI", "黄仁勋", "agent model", "the"] {
                let t0 = std::time::Instant::now();
                let hits = super::search_episodes(&conn, id, q).unwrap();
                let first = hits.first().map(|h| format!("{} [{}] {}", h.field, h.time.map(|t| t as i64).unwrap_or(-1), h.snippet)).unwrap_or_default();
                println!("{title} / {q}: {} hits in {:?}; {first}", hits.len(), t0.elapsed());
            }
        }
    }
    #[tokio::test]
    #[ignore]
    async fn chinese_show_opens_in_chinese() {
        let extra = std::env::var("YT_IDS").unwrap_or_default();
        for id in ["tBMlXQIrYK4", "1NHPDzpfR6Y", "2hJkprFnzhY"].into_iter().chain(extra.split_whitespace()) {
            let info = youtube::video_info(id).await.unwrap();
            let Some(t) = youtube::choose(&info.tracks, info.original_language.as_deref(), youtube::script_hint(&info.title)) else { println!("{id}: no captions"); continue };
            let zh = youtube::official_chinese(&info.tracks, &t.language).map(|z| z.language.clone());
            let langs: Vec<String> = info.tracks.iter().map(|t| format!("{}{}", t.language, if t.auto { "*" } else { "" })).collect();
            println!("{id} {} → {} official_zh={zh:?} tracks={langs:?}", info.title, t.language);
            if id == "tBMlXQIrYK4" { assert!(t.language.starts_with("zh")); }
            if let Some(z) = youtube::official_chinese(&info.tracks, &t.language) {
                let orig = transcript::resegment(transcript::clean(youtube::fetch_track(t).await.unwrap()));
                let items = youtube::align(&orig, &transcript::clean(youtube::fetch_track(z).await.unwrap()));
                println!("  coverage {}/{}; {:?} / {:?}", items.iter().filter(|x| x.is_some()).count(), items.len(), orig[3].text, items[3]);
            }
        }
    }
    #[tokio::test]
    #[ignore]
    async fn captions() {
        let info = youtube::video_info("dQw4w9WgXcQ").await.unwrap();
        let t = youtube::choose(&info.tracks, info.original_language.as_deref(), youtube::script_hint(&info.title)).unwrap();
        let segs = transcript::resegment(transcript::clean(youtube::fetch_track(t).await.unwrap()));
        println!("{} lang={} auto={} {} blocks; {:?}", info.title, t.language, t.auto, segs.len(), &segs[..2]);
        assert!(segs.len() > 5);
    }
    #[tokio::test]
    #[ignore]
    async fn innertube_streams() {
        let s = youtube::streams("dQw4w9WgXcQ", youtube::StreamUse::Video).await.unwrap();
        println!("hls={:?}\nmp4={:?}\naudio={:?}", s.hls.as_deref().map(|u| &u[..u.len().min(90)]), s.mp4.as_deref().map(|u| &u[..u.len().min(90)]), s.audio.as_deref().map(|u| &u[..u.len().min(90)]));
        assert!(s.hls.is_some() || s.mp4.is_some());
        let dest = std::env::temp_dir().join("subcast-yt-audio.m4a");
        let s = youtube::streams("dQw4w9WgXcQ", youtube::StreamUse::Audio).await.unwrap();
        youtube::download_stream(s.audio.as_deref().unwrap(), &s.ua, &dest, &AtomicBool::new(false), |_, _| {}).await.unwrap();
        let samples = asr::decode_16k_mono(&dest).unwrap();
        println!("decoded {:.1} s", samples.len() as f64 / 16000.0);
        assert!(samples.len() > 16000 * 60);
    }
}
