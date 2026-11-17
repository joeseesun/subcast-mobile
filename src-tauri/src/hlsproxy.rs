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
pub async fn proxied(url: &str) -> Result<String> { Ok(wrap(&base().await?, url)) }

fn wrap(base: &str, url: &str) -> String { format!("{base}/p?u={}", urlencoding::encode(url)) }

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
    let target = path.strip_prefix(&format!("/{token}/p?u="))
        .and_then(|u| urlencoding::decode(u).ok())
        .and_then(|u| Url::parse(&u).ok())
        .filter(allowed);
    let Some(target) = target else {
        sock.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
        return Ok(());
    };
    let mut req = net::client().get(target.clone());
    if let Some(r) = &range { req = req.header("Range", r); }
    let res = match req.send().await {
        Ok(r) => r,
        Err(_) => { sock.write_all(format!("HTTP/1.1 502 Bad Gateway\r\n{CORS}Content-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await?; return Ok(()); }
    };
    let status = res.status();
    let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    if kind.contains("mpegurl") || target.path().ends_with(".m3u8") || target.path().contains("/manifest/hls") {
        let body = rewrite(&res.text().await?, &target, base);
        sock.write_all(format!("HTTP/1.1 {} {}\r\nContent-Type: {kind}\r\n{CORS}Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""), body.len()).as_bytes()).await?;
        sock.write_all(body.as_bytes()).await?;
        return Ok(());
    }
    let mut extra = String::new();
    for h in ["content-length", "content-range", "accept-ranges"] {
        if let Some(v) = res.headers().get(h).and_then(|v| v.to_str().ok()) { extra.push_str(&format!("{h}: {v}\r\n")); }
    }
    sock.write_all(format!("HTTP/1.1 {} {}\r\nContent-Type: {kind}\r\n{CORS}{extra}Connection: close\r\n\r\n", status.as_u16(), status.canonical_reason().unwrap_or("")).as_bytes()).await?;
    let mut body = res.bytes_stream();
    while let Some(part) = body.next().await {
        sock.write_all(&part.map_err(|e| anyhow!(e))?).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn playlists_point_back_through_the_proxy() {
        let from = Url::parse("https://manifest.googlevideo.com/api/manifest/hls_variant/id/1/file/index.m3u8").unwrap();
        let p = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"https://manifest.googlevideo.com/a/index.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://manifest.googlevideo.com/v/index.m3u8\nseg/1.ts\n";
        let out = rewrite(p, &from, "http://127.0.0.1:1/t");
        assert!(out.contains(r#"URI="http://127.0.0.1:1/t/p?u=https%3A%2F%2Fmanifest.googlevideo.com%2Fa%2Findex.m3u8""#), "{out}");
        assert!(out.contains("\nhttp://127.0.0.1:1/t/p?u=https%3A%2F%2Fmanifest.googlevideo.com%2Fv%2Findex.m3u8\n"));
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
        let url = super::proxied(&std::env::var("HLS_URL").unwrap()).await.unwrap();
        std::fs::write("/tmp/proxied-hls.txt", &url).unwrap();
        println!("{url}");
        tokio::time::sleep(std::time::Duration::from_secs(50)).await;
    }
}
