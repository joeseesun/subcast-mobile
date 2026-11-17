//! A loopback proxy for YouTube's HLS streams, for WebViews that can't play HLS natively (WebView2, most
//! WebKitGTK). hls.js can play them, but YouTube's playlists and segments carry no CORS header, so the WebView
//! won't let it read them. The proxy fetches them with the app's network settings, adds the header, and rewrites
//! playlist entries to come back through it. It answers only on 127.0.0.1, only under this run's random token,
//! and only for YouTube's hosts.
use crate::net;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

static BASE: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

/// `http://127.0.0.1:<port>/<token>`, starting the proxy the first time.
async fn base() -> Result<String> {
    BASE.get_or_try_init(|| async {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let token = uuid::Uuid::new_v4().simple().to_string();
        let base = format!("http://127.0.0.1:{port}/{token}");
        let root = base.clone();
        tokio::spawn(async move {
            while let Ok((sock, _)) = listener.accept().await {
                let (token, root) = (token.clone(), root.clone());
                tokio::spawn(async move { let _ = serve(sock, &token, &root).await; });
            }
        });
        Ok::<_, anyhow::Error>(base)
    }).await.cloned()
}

/// The proxied address of a YouTube HLS playlist.
pub async fn proxied(url: &str, agent: &str, mp4: bool) -> Result<String> {
    let root = format!("{}/{}", base().await?, urlencoding::encode(agent));
    Ok(if mp4 { format!("{root}/p.mp4?u={}", urlencoding::encode(url)) } else { wrap(&root, url) })
}

fn wrap(base: &str, url: &str) -> String {
    let path = if Url::parse(url).is_ok_and(|url| is_playlist_path(url.path())) { "p.m3u8" } else { "p" };
    format!("{base}/{path}?u={}", urlencoding::encode(url))
}

fn is_playlist_path(path: &str) -> bool { path.ends_with(".m3u8") || path.contains("/manifest/hls") }

fn allowed(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| h == "youtube.com" || h.ends_with(".youtube.com") || h.ends_with(".googlevideo.com"))
}

/// Points every URI in a playlist (entry lines and `URI="…"` attributes) back through the proxy.
fn rewrite(playlist: &str, from: &Url, base: &str) -> String {
    let abs = |u: &str| from.join(u.trim()).map(|x| wrap(base, x.as_str())).unwrap_or_else(|_| u.to_string());
    let attr = regex::Regex::new(r#"URI="([^"]+)""#).unwrap();
    playlist.lines().map(|line| {
        if line.starts_with('#') { attr.replace_all(line, |c: &regex::Captures| format!(r#"URI="{}""#, abs(&c[1]))).to_string() }
        else if line.trim().is_empty() { line.to_string() }
        else { abs(line) }
    }).collect::<Vec<_>>().join("\n")
}

const MP4_WINDOW: u64 = 4 * 1024 * 1024;

fn byte_range(range: &str) -> Option<(u64, Option<u64>)> {
    let (from, to) = range.strip_prefix("bytes=")?.split_once('-')?;
    let start = from.parse::<u64>().ok()?;
    let end = if to.is_empty() { None } else { Some(to.parse::<u64>().ok()?) };
    if end.is_some_and(|end| end < start) { return None }
    Some((start, end))
}

fn range_window(start: u64, end: Option<u64>) -> String {
    let limit = start.saturating_add(MP4_WINDOW - 1);
    format!("bytes={start}-{}", end.unwrap_or(limit).min(limit))
}

fn content_range(response: &reqwest::Response) -> Option<(u64, u64, u64)> {
    let value = response.headers().get("content-range")?.to_str().ok()?.strip_prefix("bytes ")?;
    let (span, total) = value.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let (start, end, total) = (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    (start <= end && end < total).then_some((start, end, total))
}

/// The CDN can throttle very large ranges to playback speed. Read a progressive
/// file in bounded windows while returning the full range AVPlayer requested.
async fn serve_mp4(
    sock: &mut TcpStream,
    request: reqwest::RequestBuilder,
    mut response: reqwest::Response,
    kind: &str,
    first: (u64, u64, u64),
    end: u64,
) -> Result<()> {
    let (start, mut last, total) = first;
    let length = end - start + 1;
    sock.write_all(format!("HTTP/1.1 206 Partial Content\r\nContent-Type: {kind}\r\n{CORS}Accept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n").as_bytes()).await?;
    loop {
        send_body(sock, response).await?;
        if last == end { return Ok(()) }
        let from = last + 1;
        response = request.try_clone().ok_or_else(|| anyhow!("cannot repeat the MP4 request"))?
            .header("Range", range_window(from, Some(end))).send().await?.error_for_status()?;
        let (next_start, next_end, next_total) = content_range(&response).ok_or_else(|| anyhow!("missing MP4 content range"))?;
        if next_start != from || next_total != total || next_end > end {
            return Err(anyhow!("unexpected MP4 content range"));
        }
        last = next_end;
    }
}

async fn send_body(sock: &mut TcpStream, response: reqwest::Response) -> Result<()> {
    let mut body = response.bytes_stream();
    while let Some(part) = body.next().await {
        sock.write_all(&part?).await?;
    }
    Ok(())
}

const CORS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range\r\n";

async fn serve(mut sock: TcpStream, token: &str, base: &str) -> Result<()> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = sock.read(&mut chunk).await?;
        if n == 0 || buf.len() > 32 * 1024 { return Ok(()); }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let range = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("range")).map(|(_, v)| v.trim().to_string()));
    if method == "OPTIONS" {
        sock.write_all(format!("HTTP/1.1 204 No Content\r\n{CORS}Connection: close\r\n\r\n").as_bytes()).await?;
        return Ok(());
    }
    let Some((agent_path, resource)) = path.strip_prefix(&format!("/{token}/")).and_then(|p| p.split_once('/')) else { return Ok(()) };
    let Some((route, raw_url)) = resource.split_once("?u=") else { return Ok(()) };
    if !matches!(route, "p" | "p.m3u8" | "p.mp4") { return Ok(()) }
    let agent = urlencoding::decode(agent_path)?;
    let target = urlencoding::decode(raw_url).ok()
        .and_then(|u| Url::parse(&u).ok())
        .filter(allowed);
    let Some(target) = target else {
        sock.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
        return Ok(());
    };
    let client = net::client();
    let req = match method {
        "HEAD" => client.head(target.clone()),
        "GET" => client.get(target.clone()),
        _ => return Ok(()),
    }.header("User-Agent", agent.as_ref()).header("Accept-Encoding", "identity");
    let progressive = if route == "p.mp4" && method == "GET" {
        range.as_deref().and_then(byte_range)
    } else {
        None
    };
    let bounded = progressive.map(|(start, end)| range_window(start, end));
    let repeat = bounded.as_ref().and_then(|_| req.try_clone());
    let range = bounded.or(range);
    let req = if let Some(r) = &range { req.header("Range", r) } else { req };
    let res = match req.send().await {
        Ok(r) => r,
        Err(_) => { sock.write_all(format!("HTTP/1.1 502 Bad Gateway\r\n{CORS}Content-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await?; return Ok(()); }
    };
    let status = res.status();
    let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        if let (Some(request), Some((begin, requested_end)), Some(first)) = (repeat, progressive, content_range(&res)) {
            let (start, last, total) = first;
            let end = requested_end.unwrap_or(total - 1).min(total - 1);
            if start == begin && last < end {
                return serve_mp4(&mut sock, request, res, &kind, first, end).await;
            }
        }
    }
    if method == "GET" && status.is_success() && (kind.contains("mpegurl") || is_playlist_path(target.path())) {
        let from = res.url().clone();
        let body = rewrite(&res.text().await?, &from, &format!("{base}/{agent_path}"));
        sock.write_all(format!("HTTP/1.1 {} {}\r\nContent-Type: application/vnd.apple.mpegurl\r\n{CORS}Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""), body.len()).as_bytes()).await?;
        sock.write_all(body.as_bytes()).await?;
        return Ok(());
    }
    let mut extra = String::new();
    for h in ["content-length", "content-range", "accept-ranges"] {
        if let Some(v) = res.headers().get(h).and_then(|v| v.to_str().ok()) { extra.push_str(&format!("{h}: {v}\r\n")); }
    }
    sock.write_all(format!("HTTP/1.1 {} {}\r\nContent-Type: {kind}\r\n{CORS}{extra}Connection: close\r\n\r\n", status.as_u16(), status.canonical_reason().unwrap_or("")).as_bytes()).await?;
    if method == "HEAD" { return Ok(()); }
    send_body(&mut sock, res).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_open_ended_and_full_file_ranges() {
        let (start, end) = byte_range("bytes=0-179130727").unwrap();
        assert_eq!(range_window(start, end), "bytes=0-4194303");
        let (start, end) = byte_range("bytes=100001-").unwrap();
        assert_eq!(range_window(start, end), "bytes=100001-4294304");
        let (start, end) = byte_range("bytes=0-1").unwrap();
        assert_eq!(range_window(start, end), "bytes=0-1");
        assert_eq!(byte_range("bytes=-256"), None);
        assert_eq!(byte_range("bytes=0-1,8-9"), None);
        assert_eq!(byte_range("bytes=9-8"), None);
    }

    #[test]
    fn playlists_point_back_through_the_proxy() {
        let from = Url::parse("https://manifest.googlevideo.com/api/manifest/hls_variant/id/1/file/index.m3u8").unwrap();
        let p = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"https://manifest.googlevideo.com/a/index.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://manifest.googlevideo.com/v/index.m3u8\nseg/1.ts\n";
        let out = rewrite(p, &from, "http://127.0.0.1:1/t");
        assert!(out.contains(r#"URI="http://127.0.0.1:1/t/p.m3u8?u=https%3A%2F%2Fmanifest.googlevideo.com%2Fa%2Findex.m3u8""#), "{out}");
        assert!(out.contains("\nhttp://127.0.0.1:1/t/p.m3u8?u=https%3A%2F%2Fmanifest.googlevideo.com%2Fv%2Findex.m3u8\n"));
        assert!(out.contains("file%2Fseg%2F1.ts"));
        assert!(out.starts_with("#EXTM3U\n#EXT-X-MEDIA"));
    }
    #[test]
    fn only_youtube_hosts() {
        assert!(allowed(&Url::parse("https://rr1---sn-abc.googlevideo.com/videoplayback?x=1").unwrap()));
        assert!(!allowed(&Url::parse("https://example.com/x.m3u8").unwrap()));
        assert!(!allowed(&Url::parse("http://manifest.googlevideo.com/x").unwrap()));
        assert!(!allowed(&Url::parse("https://googlevideo.com.evil.net/x").unwrap()));
    }
}

#[cfg(test)]
mod live {
    /// HLS_URL: a fresh YouTube HLS manifest (from yt-dlp). Serves it for 50 s and prints the proxied address,
    /// so a browser with hls.js can play it (as WebView2 does).
    #[tokio::test]
    #[ignore]
    async fn serve_for_a_browser() {
        let url = super::proxied(&std::env::var("HLS_URL").unwrap(), crate::net::UA, false).await.unwrap();
        std::fs::write("/tmp/proxied-hls.txt", &url).unwrap();
        println!("{url}");
        tokio::time::sleep(std::time::Duration::from_secs(50)).await;
    }
}
