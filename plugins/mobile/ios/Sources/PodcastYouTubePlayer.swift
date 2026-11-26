import UIKit
import WebKit

struct PodcastYouTubeLabels: Decodable {
  let title: String
  let close: String
  let unavailable: String
}

/// The official player is a fallback for videos the direct player cannot open.
final class PodcastYouTubePlayer: UIViewController, WKScriptMessageHandler {
  private let videoID: String
  private let labels: PodcastYouTubeLabels
  private let browser: WKWebView
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let message = UILabel()
  private let identity: String
  private let bridgeNonce = UUID().uuidString
  private var lastTime: Double
  private let cues: [PodcastCue]
  private var finish: ((Double) -> Void)?

  init?(videoID: String, time: Double, labels: PodcastYouTubeLabels, cues: [PodcastCue] = [], finish: @escaping (Double) -> Void) {
    guard let bundle = Bundle.main.bundleIdentifier,
          videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
    self.videoID = videoID
    self.labels = labels
    self.cues = cues
    self.lastTime = time.isFinite && time >= 0 && time < Double(Int32.max) ? time : 0
    self.identity = bundle
    self.finish = finish
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    browser = WKWebView(frame: .zero, configuration: config)
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { nil }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    title = labels.title
    navigationItem.largeTitleDisplayMode = .never
    let dismissal = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
    dismissal.accessibilityLabel = labels.close
    navigationItem.leftBarButtonItem = dismissal
    browser.configuration.userContentController.add(self, name: "podcastVideo")
    browser.isOpaque = false
    browser.backgroundColor = .black
    browser.scrollView.isScrollEnabled = false
    browser.translatesAutoresizingMaskIntoConstraints = false
    spinner.color = .white
    spinner.translatesAutoresizingMaskIntoConstraints = false
    message.text = labels.unavailable
    message.textColor = .white
    message.textAlignment = .center
    message.numberOfLines = 0
    message.isHidden = true
    message.font = .preferredFont(forTextStyle: .body)
    message.adjustsFontForContentSizeCategory = true
    message.translatesAutoresizingMaskIntoConstraints = false
    for element in [browser, spinner, message] { view.addSubview(element) }
    let area = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      browser.leadingAnchor.constraint(equalTo: area.leadingAnchor),
      browser.trailingAnchor.constraint(equalTo: area.trailingAnchor),
      browser.topAnchor.constraint(equalTo: area.topAnchor),
      browser.bottomAnchor.constraint(equalTo: area.bottomAnchor),
      spinner.centerXAnchor.constraint(equalTo: area.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: area.centerYAnchor),
      message.centerXAnchor.constraint(equalTo: area.centerXAnchor),
      message.centerYAnchor.constraint(equalTo: area.centerYAnchor),
      message.leadingAnchor.constraint(greaterThanOrEqualTo: area.leadingAnchor, constant: 24),
      message.trailingAnchor.constraint(lessThanOrEqualTo: area.trailingAnchor, constant: -24),
    ])
    NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
    spinner.startAnimating()
    let origin = "https://\(identity)"
    // The bilingual subtitles ride along: drawn over YouTube's own player, following its clock.
    let cueJSON = (try? String(data: JSONEncoder().encode(cues), encoding: .utf8)) ?? "[]"
    let safeCues = cueJSON.replacingOccurrences(of: "</", with: "<\\/")
      .replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    browser.loadHTMLString("""
      <!doctype html>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="referrer" content="strict-origin-when-cross-origin">
      <style>
        html,body,#player,iframe{width:100%;height:100%;margin:0;background:#000}
        body{position:relative;-webkit-text-size-adjust:100%}
        #cap{position:absolute;left:12px;right:12px;bottom:64px;text-align:center;pointer-events:none;font:600 17px/1.35 -apple-system,"PingFang SC",sans-serif;color:#fff;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.6)}
        #cap span{display:inline-block;padding:4px 10px;border-radius:8px;background:rgba(0,0,0,.55);margin-top:4px;-webkit-box-decoration-break:clone}
        #cap .o{font-weight:500;font-size:14px;opacity:.88}
        #cap:empty{display:none}
      </style>
      <div id="player"></div>
      <div id="cap"></div>
      <script>
        function post(data) { window.webkit.messageHandlers.podcastVideo.postMessage({ ...data, nonce: "\(bridgeNonce)" }); }
        let player, ready = false, started = false;
        function onYouTubeIframeAPIReady() {
          player = new YT.Player("player", {
            videoId: "\(videoID)",
            playerVars: { playsinline: 1, controls: 1, rel: 0, origin: "\(origin)", start: \(Int(lastTime)) },
            events: {
              onReady: () => { ready = true; post({kind:"ready"}); player.playVideo(); },
              onStateChange: event => { if (event.data === 1) started = true; },
              onError: () => post({kind:"failed"})
            }
          });
        }
        function pausePlayback() { player?.pauseVideo?.(); }
        const CUES = \(safeCues);
        const cap = document.getElementById("cap");
        let shown = -1;
        function cueAt(t) {
          let lo = 0, hi = CUES.length - 1, found = -1;
          while (lo <= hi) { const m = (lo + hi) >> 1; if (CUES[m].s <= t) { found = m; lo = m + 1; } else hi = m - 1; }
          return found >= 0 && t < CUES[found].e ? found : -1;
        }
        function line(text, cls) { const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; return s; }
        setInterval(() => {
          const time = player?.getCurrentTime?.();
          if (!Number.isFinite(time)) return;
          if (CUES.length) {
            const i = cueAt(time);
            if (i !== shown) {
              shown = i;
              cap.replaceChildren();
              if (i >= 0) {
                const c = CUES[i];
                if (c.zh) { cap.appendChild(line(c.zh)); cap.appendChild(document.createElement("br")); }
                if (c.o) cap.appendChild(line(c.o, c.zh ? "o" : ""));
              }
            }
          }
        }, 200);
        setInterval(() => {
          const time = player?.getCurrentTime?.();
          if (started && Number.isFinite(time) && time >= 0) post({kind:"time", time});
        }, 650);
        setTimeout(() => { if (!ready) post({kind:"failed"}); }, 14000);
      </script>
      <script async src="https://www.youtube.com/iframe_api" onerror="post({kind:'failed'})"></script>
      """, baseURL: URL(string: origin))
  }

  private func pause() { browser.evaluateJavaScript("pausePlayback()") }

  @objc private func backgrounded(_ notification: Notification) { pause() }

  @objc private func close() {
    guard let finish else { return }
    self.finish = nil
    pause()
    browser.stopLoading()
    browser.configuration.userContentController.removeScriptMessageHandler(forName: "podcastVideo")
    NotificationCenter.default.removeObserver(self)
    let position = lastTime
    dismiss(animated: true) { finish(position) }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive event: WKScriptMessage) {
    guard event.frameInfo.isMainFrame, let data = event.body as? [String: Any],
          data["nonce"] as? String == bridgeNonce, let kind = data["kind"] as? String else { return }
    switch kind {
    case "ready": spinner.stopAnimating()
    case "failed":
      spinner.stopAnimating()
      browser.isHidden = true
      message.isHidden = false
    case "time":
      if let time = data["time"] as? Double, time.isFinite && time >= 0 { lastTime = time }
    default: break
    }
  }
}
