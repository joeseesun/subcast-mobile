use crate::model::*;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS shows(
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, author TEXT, cover TEXT,
            feed_url TEXT NOT NULL, link TEXT, description TEXT, updated_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS episodes(
            id TEXT PRIMARY KEY, show_id TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL,
            published INTEGER, duration REAL, audio_url TEXT, video_id TEXT, link TEXT, cover TEXT, notes TEXT,
            transcript_url TEXT, transcript_type TEXT, progress REAL NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS episodes_show ON episodes(show_id, published DESC);
        CREATE TABLE IF NOT EXISTS transcripts(
            episode_id TEXT PRIMARY KEY, source TEXT NOT NULL, language TEXT NOT NULL, segments TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS blobs(
            episode_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(episode_id, kind));
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tr_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        -- Time actually spent listening (playing, not seeking), per local day and hour, for 我的收听.
        CREATE TABLE IF NOT EXISTS listens(day TEXT NOT NULL, hour INTEGER NOT NULL, episode_id TEXT NOT NULL, show_id TEXT NOT NULL,
            seconds REAL NOT NULL, translated INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, hour, episode_id));",
    )?;
    let has_deep: bool = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('episodes') WHERE name='deep'", [], |r| r.get::<_, i64>(0))? > 0;
    if !has_deep {
        conn.execute_batch("ALTER TABLE episodes ADD COLUMN deep INTEGER NOT NULL DEFAULT 0; UPDATE episodes SET deep=1 WHERE transcript_type='qiaomu';")?;
    }
    Ok(conn)
}

pub fn upsert_show(conn: &Connection, s: &Show) -> Result<()> {
    conn.execute(
        "INSERT INTO shows(id,kind,title,author,cover,feed_url,link,description,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author, cover=COALESCE(excluded.cover, shows.cover),
         link=excluded.link, description=excluded.description, updated_at=excluded.updated_at",
        params![s.id, s.kind, s.title, s.author, s.cover, s.feed_url, s.link, s.description, s.updated_at],
    )?;
    Ok(())
}

pub fn upsert_episodes(conn: &mut Connection, eps: &[Episode]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut st = tx.prepare(
            "INSERT INTO episodes(id,show_id,guid,title,published,duration,audio_url,video_id,link,cover,notes,transcript_url,transcript_type,deep)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, published=excluded.published, duration=COALESCE(excluded.duration, episodes.duration),
             audio_url=COALESCE(excluded.audio_url, episodes.audio_url), link=excluded.link, cover=COALESCE(excluded.cover, episodes.cover),
             notes=COALESCE(excluded.notes, episodes.notes), transcript_url=excluded.transcript_url, transcript_type=excluded.transcript_type, deep=excluded.deep",
        )?;
        for e in eps {
            st.execute(params![
                e.id, e.show_id, e.guid, e.title, e.published, e.duration, e.audio_url, e.video_id, e.link, e.cover, e.notes,
                e.transcript_url, e.transcript_type, e.deep
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn show_from(r: &rusqlite::Row) -> rusqlite::Result<Show> {
    Ok(Show {
        id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, author: r.get(3)?, cover: r.get(4)?, feed_url: r.get(5)?,
        link: r.get(6)?, description: r.get(7)?, updated_at: r.get(8)?, unplayed: r.get(9).unwrap_or(0),
    })
}

pub fn list_shows(conn: &Connection) -> Result<Vec<Show>> {
    let mut st = conn.prepare(
        "SELECT s.id,s.kind,s.title,s.author,s.cover,s.feed_url,s.link,s.description,s.updated_at,
         (SELECT COUNT(*) FROM episodes e WHERE e.show_id=s.id AND e.progress=0) FROM shows s WHERE s.kind != 'single' ORDER BY s.title COLLATE NOCASE",
    )?;
    let rows = st.query_map([], show_from)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_show(conn: &Connection, id: &str) -> Result<Option<Show>> {
    Ok(conn
        .query_row("SELECT id,kind,title,author,cover,feed_url,link,description,updated_at,0 FROM shows WHERE id=?1", [id], show_from)
        .optional()?)
}

pub fn delete_show(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM episodes WHERE show_id=?1 AND id NOT IN (SELECT episode_id FROM transcripts)", [id])?;
    conn.execute("DELETE FROM shows WHERE id=?1", [id])?;
    Ok(())
}

const EPISODE_COLS: &str = "e.id,e.show_id,e.guid,e.title,e.published,e.duration,e.audio_url,e.video_id,e.link,e.cover,e.notes,e.transcript_url,e.transcript_type,e.progress,
    EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id), s.title, e.deep";

fn episode_from(r: &rusqlite::Row) -> rusqlite::Result<Episode> {
    Ok(Episode {
        id: r.get(0)?, show_id: r.get(1)?, guid: r.get(2)?, title: r.get(3)?, published: r.get(4)?, duration: r.get(5)?,
        audio_url: r.get(6)?, video_id: r.get(7)?, link: r.get(8)?, cover: r.get(9)?, notes: r.get(10)?,
        transcript_url: r.get(11)?, transcript_type: r.get(12)?, progress: r.get(13)?, has_transcript: r.get(14)?, show_title: r.get(15)?,
        deep: r.get(16)?,
    })
}

pub fn list_episodes(conn: &Connection, show_id: Option<&str>, limit: i64) -> Result<Vec<Episode>> {
    // Notes are large; the list does not need them.
    let sql = format!(
        "SELECT {EPISODE_COLS} FROM episodes e LEFT JOIN shows s ON s.id=e.show_id {} ORDER BY e.published DESC LIMIT ?1",
        if show_id.is_some() { "WHERE e.show_id=?2" } else { "WHERE s.kind != 'single'" }
    );
    let mut st = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row| episode_from(r).map(|mut e| { e.notes = None; e });
    let rows = match show_id {
        Some(id) => st.query_map(params![limit, id], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
        None => st.query_map(params![limit], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
    };
    Ok(rows)
}

pub fn recent_episodes(conn: &Connection, limit: i64) -> Result<Vec<Episode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS} FROM episodes e LEFT JOIN shows s ON s.id=e.show_id
         WHERE e.progress > 0 OR EXISTS(SELECT 1 FROM transcripts t WHERE t.episode_id=e.id) OR s.kind='single'
         ORDER BY e.rowid DESC LIMIT ?1"
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params![limit], |r| episode_from(r).map(|mut e| { e.notes = None; e }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_episode(conn: &Connection, id: &str) -> Result<Option<Episode>> {
    let sql = format!("SELECT {EPISODE_COLS} FROM episodes e LEFT JOIN shows s ON s.id=e.show_id WHERE e.id=?1");
    Ok(conn.query_row(&sql, [id], episode_from).optional()?)
}

pub fn set_audio_url(conn: &Connection, id: &str, url: &str) -> Result<()> {
    conn.execute("UPDATE episodes SET audio_url=?2 WHERE id=?1", params![id, url])?;
    Ok(())
}

pub fn set_progress(conn: &Connection, id: &str, seconds: f64) -> Result<()> {
    conn.execute("UPDATE episodes SET progress=?2 WHERE id=?1", params![id, seconds.max(0.01)])?;
    Ok(())
}

pub fn save_transcript(conn: &Connection, t: &Transcript) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO transcripts(episode_id,source,language,segments,created_at) VALUES(?1,?2,?3,?4,?5)",
        params![t.episode_id, t.source, t.language, serde_json::to_string(&t.segments)?, now_ms()],
    )?;
    // A new transcript invalidates translations and summaries made from the old one.
    conn.execute("DELETE FROM blobs WHERE episode_id=?1 AND kind NOT IN ('chat', 'chat-archive', 'notes-full', 'ctx')", [&t.episode_id])?;
    Ok(())
}

pub fn get_transcript(conn: &Connection, id: &str) -> Result<Option<Transcript>> {
    let row: Option<(String, String, String)> = conn
        .query_row("SELECT source,language,segments FROM transcripts WHERE episode_id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    Ok(match row {
        Some((source, language, segs)) => Some(Transcript { episode_id: id.to_string(), source, language, segments: serde_json::from_str(&segs)? }),
        None => None,
    })
}

pub fn get_blob(conn: &Connection, id: &str, kind: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT data FROM blobs WHERE episode_id=?1 AND kind=?2", [id, kind], |r| r.get(0)).optional()?)
}

pub fn set_blob(conn: &Connection, id: &str, kind: &str, data: &str) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO blobs(episode_id,kind,data) VALUES(?1,?2,?3)", params![id, kind, data])?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)", params![key, value])?;
    Ok(())
}

pub fn tr_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM tr_cache WHERE key=?1", [key], |r| r.get(0)).optional()?)
}

pub fn tr_put(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO tr_cache(key,value) VALUES(?1,?2)", params![key, value])?;
    Ok(())
}

/// Adds listening time to today's row for this hour (local time).
pub fn log_listen(conn: &Connection, episode_id: &str, show_id: &str, seconds: f64, translated: bool) -> Result<()> {
    let now = chrono::Local::now();
    conn.execute(
        "INSERT INTO listens(day,hour,episode_id,show_id,seconds,translated) VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(day,hour,episode_id) DO UPDATE SET seconds = seconds + excluded.seconds, translated = MAX(translated, excluded.translated)",
        params![now.format("%Y-%m-%d").to_string(), now.format("%H").to_string().parse::<i64>().unwrap_or(0), episode_id, show_id, seconds.clamp(0.0, 120.0), translated as i64],
    )?;
    Ok(())
}

/// Every listening row since a day (YYYY-MM-DD), with the episode's show and kind for grouping.
pub fn listens_since(conn: &Connection, since: &str) -> Result<Vec<serde_json::Value>> {
    let mut st = conn.prepare(
        "SELECT l.day, l.hour, l.episode_id, l.show_id, l.seconds, l.translated, COALESCE(s.title,''), COALESCE(s.kind,''), COALESCE(s.cover,''), COALESCE(e.title,''), COALESCE(e.video_id,''),
                COALESCE(e.duration,0), COALESCE(e.progress,0), COALESCE(e.published,0)
         FROM listens l LEFT JOIN shows s ON s.id = l.show_id LEFT JOIN episodes e ON e.id = l.episode_id WHERE l.day >= ?1 ORDER BY l.day")?;
    let rows = st.query_map([since], |r| Ok(serde_json::json!({
        "day": r.get::<_, String>(0)?, "hour": r.get::<_, i64>(1)?, "episodeId": r.get::<_, String>(2)?, "showId": r.get::<_, String>(3)?,
        "seconds": r.get::<_, f64>(4)?, "translated": r.get::<_, i64>(5)? == 1, "showTitle": r.get::<_, String>(6)?, "kind": r.get::<_, String>(7)?,
        "cover": r.get::<_, String>(8)?, "episodeTitle": r.get::<_, String>(9)?, "video": !r.get::<_, String>(10)?.is_empty(),
        "duration": r.get::<_, f64>(11)?, "progress": r.get::<_, f64>(12)?, "published": r.get::<_, i64>(13)?,
    })))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_column_migrates_and_round_trips() {
        let path = std::env::temp_dir().join(format!("subcast-db-test-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            // A database from before the deep column existed.
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE episodes(id TEXT PRIMARY KEY, show_id TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL,
                 published INTEGER, duration REAL, audio_url TEXT, video_id TEXT, link TEXT, cover TEXT, notes TEXT,
                 transcript_url TEXT, transcript_type TEXT, progress REAL NOT NULL DEFAULT 0);
                 INSERT INTO episodes(id,show_id,guid,title,transcript_type) VALUES('a','s','g','A','qiaomu'),('b','s','h','B',NULL);",
            ).unwrap();
        }
        let mut conn = open(&path).unwrap();
        assert!(get_episode(&conn, "a").unwrap().unwrap().deep);
        assert!(!get_episode(&conn, "b").unwrap().unwrap().deep);
        // Reopening must not try to add the column again.
        drop(conn);
        conn = open(&path).unwrap();
        let mut ep = get_episode(&conn, "b").unwrap().unwrap();
        ep.deep = true;
        upsert_episodes(&mut conn, std::slice::from_ref(&ep)).unwrap();
        assert!(get_episode(&conn, "b").unwrap().unwrap().deep);
        ep.deep = false;
        upsert_episodes(&mut conn, std::slice::from_ref(&ep)).unwrap();
        assert!(!get_episode(&conn, "b").unwrap().unwrap().deep);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
