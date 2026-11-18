//! A loopback proxy for YouTube media. It fetches through the configured network path, adds CORS headers,
//! rewrites HLS playlists, and streams MP4 byte ranges to the player. Requests require this run's random
//! token and a YouTube media host.
use crate::net;
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Url;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

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

/// The local address of a YouTube HLS or progressive MP4 source.
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

// QuickTime probes the file header, then issues overlapping reads for its index.
// Share the leading bytes without making those readers wait for the entire prefix.
const MP4_PREFIX_BYTES: u64 = 2 * 1024 * 1024;
const MP4_PREFIX_TTL: Duration = Duration::from_secs(90);
const MP4_PREFIX_WAIT: Duration = Duration::from_millis(1500);
static MP4_PREFIXES: Mutex<VecDeque<RetainedPrefix>> = Mutex::new(VecDeque::new());

struct RetainedPrefix {
    target: Url,
    agent: String,
    proxy: String,
    created: Instant,
    prefix: Mp4Prefix,
}

#[derive(Clone)]
struct Mp4Prefix {
    bytes: Arc<Mutex<Vec<u8>>>,
    updates: watch::Receiver<Option<Arc<PrefixHeader>>>,
}

struct PrefixHeader {
    length: u64,
    total: u64,
    kind: String,
}

impl Mp4Prefix {
    fn start(request: reqwest::RequestBuilder) -> Self {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let (updates, receiver) = watch::channel(None);
        tokio::spawn({
            let bytes = bytes.clone();
            async move {
                let _ = tokio::time::timeout(Duration::from_secs(12), Self::fetch(request, bytes, updates)).await;
            }
        });
        Self { bytes, updates: receiver }
    }

    async fn fetch(
        request: reqwest::RequestBuilder,
        bytes: Arc<Mutex<Vec<u8>>>,
        updates: watch::Sender<Option<Arc<PrefixHeader>>>,
    ) -> Result<()> {
        let response = request.header("Range", format!("bytes=0-{}", MP4_PREFIX_BYTES - 1)).send().await?;
        let (start, end, total) = content_range(&response).ok_or_else(|| anyhow!("missing MP4 prefix range"))?;
        let length = total.min(MP4_PREFIX_BYTES);
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT || start != 0 || end + 1 != length {
            return Err(anyhow!("unexpected MP4 prefix range"));
        }
        updates.send_replace(Some(Arc::new(PrefixHeader { length, total, kind: content_type(&response) })));
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            {
                let mut bytes = bytes.lock().unwrap();
                if bytes.len() as u64 + chunk.len() as u64 > length { return Err(anyhow!("oversized MP4 prefix")); }
                bytes.extend_from_slice(&chunk);
            }
            updates.send_modify(|_| {});
        }
        Ok(())
    }

    async fn header(&mut self) -> Option<Arc<PrefixHeader>> {
        loop {
            if let Some(header) = self.updates.borrow_and_update().clone() { return Some(header) }
            self.updates.changed().await.ok()?;
        }
    }

    async fn send(&mut self, sock: &mut TcpStream, mut from: u64, to: u64) -> Result<u64> {
        while from <= to {
            let chunk = {
                let bytes = self.bytes.lock().unwrap();
                let end = bytes.len().min((to + 1) as usize).min(from as usize + 65_536);
                bytes.get(from as usize..end).unwrap_or_default().to_vec()
            };
            if chunk.is_empty() {
                if !matches!(tokio::time::timeout(MP4_PREFIX_WAIT, self.updates.changed()).await, Ok(Ok(()))) { break; }
            } else {
                sock.write_all(&chunk).await?;
                from += chunk.len() as u64;
            }
        }
        Ok(from)
    }
}

fn mp4_prefix(target: &Url, agent: &str, request: reqwest::RequestBuilder) -> Option<Mp4Prefix> {
    let proxy = net::proxy();
    let mut entries = MP4_PREFIXES.lock().unwrap();
    entries.retain(|entry| entry.created.elapsed() < MP4_PREFIX_TTL);
    if let Some(entry) = entries.iter().find(|entry| entry.target == *target && entry.agent == agent && entry.proxy == proxy) {
        return Some(entry.prefix.clone());
    }
    if entries.len() == 2 {
        // A rapid episode switch must not start another speculative read while both readers are active.
        let finished = entries.iter().position(|entry| entry.prefix.updates.has_changed().is_err())?;
        entries.remove(finished);
    }
    let prefix = Mp4Prefix::start(request);
    entries.push_back(RetainedPrefix { target: target.clone(), agent: agent.into(), proxy, created: Instant::now(), prefix: prefix.clone() });
    Some(prefix)
}

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

fn content_type(response: &reqwest::Response) -> String {
    response.headers().get("content-type").and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream").to_string()
}

async fn write_mp4_header(sock: &mut TcpStream, kind: &str, start: u64, end: u64, total: u64) -> Result<()> {
    let length = end - start + 1;
    sock.write_all(format!("HTTP/1.1 206 Partial Content\r\nContent-Type: {kind}\r\n{CORS}Accept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n").as_bytes()).await?;
    Ok(())
}

/// The CDN can throttle very large ranges to playback speed. Read a progressive
/// file in bounded windows while returning the full range AVPlayer requested.
async fn serve_mp4_tail(
    sock: &mut TcpStream,
    request: reqwest::RequestBuilder,
    mut from: u64,
    end: u64,
    total: u64,
) -> Result<()> {
    while from <= end {
        let response = request.try_clone().ok_or_else(|| anyhow!("cannot repeat the MP4 request"))?
            .header("Range", range_window(from, Some(end))).send().await?.error_for_status()?;
        let (next_start, next_end, next_total) = content_range(&response).ok_or_else(|| anyhow!("missing MP4 content range"))?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT || next_start != from || next_total != total || next_end > end {
            return Err(anyhow!("unexpected MP4 content range"));
        }
        send_body(sock, response).await?;
        from = next_end + 1;
    }
    Ok(())
}

async fn serve_mp4_prefix(
    sock: &mut TcpStream,
    request: reqwest::RequestBuilder,
    mut prefix: Mp4Prefix,
    start: u64,
    end: Option<u64>,
) -> Result<bool> {
    let Ok(Some(head)) = tokio::time::timeout(MP4_PREFIX_WAIT, prefix.header()).await else { return Ok(false) };
    if start >= head.length { return Ok(false) }
    let end = end.unwrap_or(head.total - 1).min(head.total - 1);
    write_mp4_header(sock, &head.kind, start, end, head.total).await?;
    let prefix_end = end.min(head.length - 1);
    // If the upstream closed early, resume at the exact byte already written.
    let next = prefix.send(sock, start, prefix_end).await?;
    serve_mp4_tail(sock, request, next, end, head.total).await?;
    Ok(true)
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
    if let Some((start, end)) = progressive.filter(|(start, _)| cfg!(target_os = "ios") && *start < MP4_PREFIX_BYTES) {
        if let (Some(prefix_request), Some(tail_request)) = (req.try_clone(), req.try_clone()) {
            if let Some(prefix) = mp4_prefix(&target, agent.as_ref(), prefix_request) {
                // Start warming on the two-byte capability probe, while the probe itself goes straight upstream.
                if !(start == 0 && end == Some(1)) && serve_mp4_prefix(&mut sock, tail_request, prefix, start, end).await? {
                    return Ok(());
                }
            }
        }
    }
    let bounded = progressive.map(|(start, end)| range_window(start, end));
    let repeat = bounded.as_ref().and_then(|_| req.try_clone());
    let range = bounded.or(range);
    let req = if let Some(r) = &range { req.header("Range", r) } else { req };
    let res = match req.send().await {
        Ok(r) => r,
        Err(_) => { sock.write_all(format!("HTTP/1.1 502 Bad Gateway\r\n{CORS}Content-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await?; return Ok(()); }
    };
    let status = res.status();
    let kind = content_type(&res);
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        if let (Some(request), Some((begin, requested_end)), Some(first)) = (repeat, progressive, content_range(&res)) {
            let (start, last, total) = first;
            let end = requested_end.unwrap_or(total - 1).min(total - 1);
            if start == begin && last < end {
                write_mp4_header(&mut sock, &kind, start, end, total).await?;
                send_body(&mut sock, res).await?;
                return serve_mp4_tail(&mut sock, request, last + 1, end, total).await;
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

    #[tokio::test]
    async fn prefix_serves_overlapping_reads_and_resumes_a_stalled_fetch() {
        use tokio::io::{AsyncBufReadExt, BufReader};
        async fn read_headers(reader: &mut BufReader<TcpStream>) -> String {
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                let size = reader.read_line(&mut line).await.unwrap();
                if size == 0 || line == "\r\n" { return headers; }
                headers.push_str(&line);
            }
        }
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let request = reqwest::Client::builder().no_proxy().build().unwrap()
            .get(format!("http://{}/media.mp4", origin.local_addr().unwrap()));
        let tail = tokio::spawn(async move {
            let mut upstream = BufReader::new(origin.accept().await.unwrap().0);
            let headers = read_headers(&mut upstream).await;
            assert!(headers.to_ascii_lowercase().contains("range: bytes=3-7\r\n"));
            upstream.get_mut().write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 3-7/8\r\nContent-Length: 5\r\nConnection: close\r\n\r\nDEFGH").await.unwrap();
        });

        let (updates, receiver) = watch::channel(Some(Arc::new(PrefixHeader {
            length: 6, total: 8, kind: "video/mp4".into(),
        })));
        let prefix = Mp4Prefix { bytes: Arc::new(Mutex::new(b"ABC".to_vec())), updates: receiver };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut reader = BufReader::new(TcpStream::connect(listener.local_addr().unwrap()).await.unwrap());
        let mut another = BufReader::new(TcpStream::connect(listener.local_addr().unwrap()).await.unwrap());
        let main_task = tokio::spawn({
            let request = request.try_clone().unwrap();
            let prefix = prefix.clone();
            let mut socket = listener.accept().await.unwrap().0;
            async move { assert!(serve_mp4_prefix(&mut socket, request, prefix, 0, None).await.unwrap()); }
        });
        let overlap = tokio::spawn(async move {
            let mut socket = listener.accept().await.unwrap().0;
            assert!(serve_mp4_prefix(&mut socket, request, prefix, 1, Some(2)).await.unwrap());
        });

        let headers = read_headers(&mut reader).await;
        assert!(headers.contains("Content-Range: bytes 0-7/8\r\n"));
        assert!(headers.contains("Content-Length: 8\r\n"));
        let mut first = [0; 3];
        tokio::time::timeout(Duration::from_secs(1), reader.read_exact(&mut first)).await.unwrap().unwrap();
        assert_eq!(&first, b"ABC");
        let headers = read_headers(&mut another).await;
        assert!(headers.contains("Content-Range: bytes 1-2/8\r\n"));
        let mut shared = [0; 2];
        tokio::time::timeout(Duration::from_secs(1), another.read_exact(&mut shared)).await.unwrap().unwrap();
        assert_eq!(&shared, b"BC");

        let mut rest = Vec::new();
        tokio::time::timeout(Duration::from_secs(4), reader.read_to_end(&mut rest)).await.unwrap().unwrap();
        assert_eq!(&rest, b"DEFGH");
        drop(updates);
        main_task.await.unwrap();
        overlap.await.unwrap();
        tail.await.unwrap();
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
