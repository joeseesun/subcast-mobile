//! Serves the interface on http://localhost:<port> and keeps the page alive.
//!
//! Release builds load the interface from localhost because YouTube's embedded player refuses pages from
//! `tauri://` (no valid origin). On a phone that page can go white in three ways, and each lasted until the next
//! cold launch:
//! - iOS reclaims a suspended app's listening sockets. tiny_http's accept thread stops on the first error, so the
//!   server was gone for good after the app came back from the background.
//! - iOS kills the WKWebView content process (memory pressure, long time in the background). WKWebView then shows
//!   an empty view and nothing reloads it.
//! - The page asked for `localhost` before anything answered on the address family it tried first.
//!
//! So the port is bound before the window opens, on 127.0.0.1 and ::1. A server that stops is rebound. Coming
//! back to the foreground probes it. A dead content process, or a launch that never reported ready, reloads the
//! page.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::ota;

/// The interface's first-choice port. localStorage belongs to the origin, so the page stays on it when it can.
pub const LOCAL_PORT: u16 = 14327;
/// How many ports from LOCAL_PORT the interface may use. Each is listed in capabilities/default.json
/// (remote.urls); a test keeps the two in step.
pub const UI_PORTS: u16 = 20;

static PORT: AtomicU16 = AtomicU16::new(0);
static READY: AtomicBool = AtomicBool::new(false);
static ADDRS: Mutex<Vec<SocketAddr>> = Mutex::new(Vec::new());
/// The running servers and their generation; a server from an older generation was replaced on purpose.
static SERVERS: Mutex<Vec<Arc<tiny_http::Server>>> = Mutex::new(Vec::new());
static GEN: AtomicU64 = AtomicU64::new(0);
static APP: OnceLock<(AppHandle, ota::Active)> = OnceLock::new();

/// Candidate ports: `preferred` first, then the rest of the allowed range.
fn candidates(preferred: u16) -> impl Iterator<Item = u16> {
    std::iter::once(preferred).chain((LOCAL_PORT..LOCAL_PORT + UI_PORTS).filter(move |p| *p != preferred))
}

/// A loopback port nothing else answers on, bound on 127.0.0.1 and on ::1. The page opens `localhost`, which may
/// resolve to either family, so someone else on [::1]:port would otherwise answer it.
pub fn bind_port(preferred: u16) -> Option<(u16, Vec<TcpListener>)> {
    for port in candidates(preferred) {
        let Ok(v4) = TcpListener::bind(("127.0.0.1", port)) else { continue };
        match TcpListener::bind(("::1", port)) {
            Ok(v6) => return Some((port, vec![v4, v6])),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            // No IPv6 here: IPv4 alone is what "localhost" means.
            Err(_) => return Some((port, vec![v4])),
        }
    }
    None
}

/// The page's address on the current port.
pub fn url() -> tauri::Url {
    format!("http://localhost:{}", PORT.load(Ordering::SeqCst)).parse().unwrap()
}

/// The page rendered (the `ui_ready` command).
pub fn mark_ready() { READY.store(true, Ordering::SeqCst); }

/// Every bound address accepts a connection.
fn alive() -> bool {
    let addrs = ADDRS.lock().unwrap().clone();
    !addrs.is_empty() && addrs.iter().all(|a| TcpStream::connect_timeout(a, Duration::from_millis(400)).is_ok())
}

/// Starts serving. Call once in setup, before the window opens; returns the port.
pub fn start(app: &AppHandle, active: ota::Active) -> u16 {
    let _ = APP.set((app.clone(), active));
    ensure();
    PORT.load(Ordering::SeqCst)
}

/// Makes sure the server answers, rebinding when it stopped. Returns true when the port changed.
fn ensure() -> bool {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap();
    if alive() { return false; }
    let Some((app, active)) = APP.get() else { return false };
    let old = PORT.load(Ordering::SeqCst);
    let preferred = if old == 0 { LOCAL_PORT } else { old };
    // One family may still be served (say ::1 kept working while 127.0.0.1 failed): release it, so the same port
    // can be bound again and the page keeps its origin.
    let generation = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let stale: Vec<_> = std::mem::take(&mut *SERVERS.lock().unwrap());
    if !stale.is_empty() {
        for s in &stale { s.unblock(); }
        drop(stale);
        std::thread::sleep(Duration::from_millis(250));
    }
    let Some((port, listeners)) = bind_port(preferred) else {
        eprintln!("SubCast: no free port for the interface near {LOCAL_PORT}");
        if old == 0 { PORT.store(LOCAL_PORT, Ordering::SeqCst); }
        return false;
    };
    let (mut addrs, mut servers) = (Vec::new(), Vec::new());
    for listener in listeners {
        let Ok(addr) = listener.local_addr() else { continue };
        let Ok(server) = tiny_http::Server::from_listener(listener, None) else { continue };
        let server = Arc::new(server);
        addrs.push(addr);
        servers.push(server.clone());
        let (resolver, active) = (app.asset_resolver(), active.clone());
        std::thread::spawn(move || {
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
            drop(server);
            // Replaced on purpose by a newer generation: nothing to do.
            if GEN.load(Ordering::SeqCst) != generation { return; }
            // The listener failed (iOS reclaimed it while suspended): serve again, and move the page if the port moved.
            std::thread::sleep(Duration::from_millis(300));
            if ensure() { reload(); }
        });
    }
    *SERVERS.lock().unwrap() = servers;
    *ADDRS.lock().unwrap() = addrs;
    PORT.store(port, Ordering::SeqCst);
    if old != 0 && port != old { eprintln!("SubCast: interface moved from port {old} to {port}"); }
    old != 0 && port != old
}

/// Loads the page again from the current address.
fn reload() {
    let Some((app, _)) = APP.get() else { return };
    let Some(w) = app.get_webview_window("main") else { return };
    READY.store(false, Ordering::SeqCst);
    let _ = w.navigate(url());
}

/// Back in the foreground: the server may have lost its socket while suspended.
pub fn resumed() {
    if ensure() || !READY.load(Ordering::SeqCst) { reload(); }
}

/// WKWebView's content process died: the view is empty until the page loads again.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn content_process_died() {
    ensure();
    reload();
}

/// A launch that never rendered (the first request found nothing listening, say) gets two more tries.
pub fn watch_launch() {
    std::thread::spawn(|| {
        for wait in [8, 12] {
            std::thread::sleep(Duration::from_secs(wait));
            if READY.load(Ordering::SeqCst) { return; }
            eprintln!("SubCast: the interface did not report ready after {wait}s; loading it again");
            ensure();
            reload();
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn takes_the_next_port_when_one_is_used() {
        // A range of its own, away from a running app's LOCAL_PORT.
        let base = super::LOCAL_PORT + 10;
        let _held = std::net::TcpListener::bind(("127.0.0.1", base)).unwrap();
        let (port, _l) = super::bind_port(base).expect("a free port");
        assert_ne!(port, base);
        assert!((super::LOCAL_PORT..super::LOCAL_PORT + super::UI_PORTS).contains(&port));
    }

    /// Every port the interface may move to is allowed to call the app's commands.
    #[test]
    fn every_ui_port_is_allowed() {
        let caps = include_str!("../capabilities/default.json");
        for p in super::LOCAL_PORT..super::LOCAL_PORT + super::UI_PORTS {
            assert!(caps.contains(&format!("\"http://localhost:{p}\"")), "port {p} missing from capabilities");
        }
    }
}
