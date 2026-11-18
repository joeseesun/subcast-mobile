import AVFoundation
import AVKit
import UIKit
import WebKit

struct PodcastVideoLayout: Decodable, Equatable {
  let visible: Bool
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let clipTop: Double
  let clipBottom: Double
  let rounded: Bool
  let theater: Bool
  let translated: String?
  let original: String?
  let font: String
  let scale: Double
  let boxed: Bool
}

/// A single video layer in the WebView's documented viewport, and the same AVPlayer in full screen.
final class PodcastVideoSurface: NSObject, AVPlayerViewControllerDelegate {
  private let clippingView = UIView()
  private let picture = PictureView()
  private weak var host: UIView?
  private weak var webView: WKWebView?
  private var player: AVPlayer? { picture.playerLayer.player }
  private var pictureStatus: NSKeyValueObservation?
  private var fullscreenBounds: NSKeyValueObservation?
  private weak var fullscreen: AVPlayerViewController?
  private weak var fullCaption: CaptionOverlay?
  private var layout: PodcastVideoLayout?
  private var canShowPicture = false
  private var transitioningFullscreen = false
  private var pictureInPicture = false
  /// Full screen reads its subtitles from this timeline on the player's own clock: the WebView behind a
  /// full-screen presentation leaves the window and stops measuring its overlay.
  private var cues = [PodcastCue]()
  private var cueObserver: Any?
  private weak var cuePlayer: AVPlayer?
  var didReturnInline: (() -> Void)?

  var isFullscreen: Bool {
    guard let fullscreen, !transitioningFullscreen, !fullscreen.isBeingDismissed else { return false }
    return fullscreen.viewIfLoaded?.window != nil || pictureInPicture
  }

  override init() {
    super.init()
    clippingView.clipsToBounds = true
    clippingView.isUserInteractionEnabled = false
    clippingView.accessibilityElementsHidden = true
    clippingView.isHidden = true
    clippingView.addSubview(picture)
  }

  func attach(_ player: AVPlayer, webView: WKWebView, host: UIView) {
    stop()
    self.webView = webView
    self.host = host
    host.addSubview(clippingView)
    picture.playerLayer.player = player
    pictureStatus = picture.playerLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] layer, _ in
      DispatchQueue.main.async {
        guard let self, self.player === player else { return }
        self.canShowPicture = layer.isReadyForDisplay
        self.place()
      }
    }
  }

  func stop() {
    stopCues()
    cues = []
    pictureStatus = nil
    fullscreenBounds = nil
    picture.playerLayer.player = nil
    canShowPicture = false
    layout = nil
    clippingView.isHidden = true
    clippingView.removeFromSuperview()
    let controller = fullscreen
    fullscreen = nil
    fullCaption = nil
    transitioningFullscreen = false
    pictureInPicture = false
    if let fullscreen = controller {
      fullscreen.player = nil
      if fullscreen.presentingViewController != nil { fullscreen.dismiss(animated: true) }
    }
  }

  func update(_ layout: PodcastVideoLayout) {
    guard self.layout != layout else { return }
    self.layout = layout
    place()
    fullCaption?.configure(layout)
  }

  func setCues(_ cues: [PodcastCue]) {
    self.cues = cues
    guard let caption = fullCaption else { return }
    caption.cueDriven = !cues.isEmpty
    if cues.isEmpty, let layout { caption.configure(layout) }
    if let time = player?.currentTime().seconds { showCue(at: time) }
  }

  private func startCues() {
    stopCues()
    guard let player else { return }
    cuePlayer = player
    cueObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main) { [weak self] time in
      self?.showCue(at: time.seconds)
    }
    showCue(at: player.currentTime().seconds)
  }

  private func stopCues() {
    if let cueObserver { cuePlayer?.removeTimeObserver(cueObserver) }
    cueObserver = nil
    cuePlayer = nil
  }

  private func showCue(at time: Double) {
    guard let caption = fullCaption, !cues.isEmpty, time.isFinite else { return }
    var low = 0, high = cues.count - 1, found = -1
    while low <= high {
      let mid = (low + high) / 2
      if cues[mid].s <= time { found = mid; low = mid + 1 } else { high = mid - 1 }
    }
    let cue = found >= 0 && time <= cues[found].e ? cues[found] : nil
    caption.setText(translated: cue?.zh, original: cue?.o)
  }

  func setTransport(playing: Bool, waiting: Bool) {
    picture.playMark.isHidden = playing || waiting
    picture.waiting.isHidden = !waiting
    if waiting { picture.waiting.startAnimating() } else { picture.waiting.stopAnimating() }
  }

  func showFullscreen(from parent: UIViewController) -> Bool {
    guard let player, parent.presentedViewController == nil, parent.viewIfLoaded?.window != nil else { return false }
    let controller = AVPlayerViewController()
    controller.player = player
    controller.delegate = self
    controller.modalPresentationStyle = .fullScreen
    controller.allowsPictureInPicturePlayback = true
    controller.updatesNowPlayingInfoCenter = false
    controller.videoGravity = .resizeAspect
    fullscreen = controller
    transitioningFullscreen = true
    parent.present(controller, animated: true) { [weak self, weak controller] in
      guard let self, let controller, self.fullscreen === controller, let overlay = controller.contentOverlayView else { return }
      self.transitioningFullscreen = false
      let caption = CaptionOverlay()
      caption.isFullscreen = true
      caption.didLeaveWindow = { [weak self, weak controller] in
        DispatchQueue.main.async {
          guard let controller, controller.isBeingDismissed || controller.presentingViewController == nil else { return }
          self?.finishFullscreen(controller)
        }
      }
      caption.frame = overlay.bounds
      caption.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      overlay.addSubview(caption)
      caption.cueDriven = !self.cues.isEmpty
      if let layout = self.layout { caption.configure(layout) }
      self.fullCaption = caption
      self.startCues()
      self.fullscreenBounds = controller.observe(\.videoBounds, options: [.initial, .new]) { [weak caption, weak overlay] player, _ in
        DispatchQueue.main.async {
          guard let caption, let overlay else { return }
          caption.videoFrame = overlay.convert(player.videoBounds, from: player.view)
        }
      }
    }
    return true
  }

  func playerViewController(
    _ playerViewController: AVPlayerViewController,
    willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator
  ) {
    guard fullscreen === playerViewController else { return }
    transitioningFullscreen = true
    coordinator.animate(alongsideTransition: nil) { [weak self, weak playerViewController] context in
      guard let self, let playerViewController, self.fullscreen === playerViewController else { return }
      if context.isCancelled {
        self.transitioningFullscreen = false
      } else {
        self.finishFullscreen(playerViewController)
      }
    }
  }

  func playerViewControllerWillStartPictureInPicture(_ playerViewController: AVPlayerViewController) {
    if fullscreen === playerViewController { pictureInPicture = true }
  }

  func playerViewController(_ playerViewController: AVPlayerViewController, failedToStartPictureInPictureWithError error: Error) {
    if fullscreen === playerViewController { pictureInPicture = false }
  }

  func playerViewControllerDidStopPictureInPicture(_ playerViewController: AVPlayerViewController) {
    guard fullscreen === playerViewController else { return }
    pictureInPicture = false
    if playerViewController.presentingViewController == nil { finishFullscreen(playerViewController) }
  }

  private func finishFullscreen(_ controller: AVPlayerViewController) {
    guard fullscreen === controller, !pictureInPicture else { return }
    stopCues()
    fullscreen = nil
    fullCaption = nil
    fullscreenBounds = nil
    transitioningFullscreen = false
    controller.player = nil
    didReturnInline?()
  }

  func playerViewController(
    _ playerViewController: AVPlayerViewController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
  ) {
    guard player === playerViewController.player else { completionHandler(false); return }
    // The inline session remains mounted even while the reader is browsing elsewhere.
    completionHandler(true)
  }

  private func place() {
    guard let layout, layout.visible, canShowPicture, let webView, let host,
          layout.width > 0, layout.height > 0, layout.width <= 4000, layout.height <= 4000 else {
      clippingView.isHidden = true
      return
    }
    let frame = webView.convert(CGRect(x: layout.x, y: layout.y, width: layout.width, height: layout.height), to: host)
    let displayed = CGRect(x: frame.minX, y: frame.minY + layout.clipTop, width: frame.width,
                           height: max(0, frame.height - layout.clipTop - layout.clipBottom))
      .intersection(webView.convert(webView.bounds, to: host))
      .intersection(host.bounds)
    clippingView.isHidden = displayed.isEmpty || displayed.isNull
    if clippingView.isHidden { return }
    clippingView.frame = displayed
    clippingView.layer.cornerRadius = layout.rounded ? 7 : 0
    picture.frame = frame.offsetBy(dx: -displayed.minX, dy: -displayed.minY)
    picture.fullscreenMark.isHidden = layout.rounded || layout.theater
    picture.caption.configure(layout)
    picture.setNeedsLayout()
  }
}

private final class PictureView: UIView {
  override static var layerClass: AnyClass { AVPlayerLayer.self }
  var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

  let caption = CaptionOverlay()
  let playMark = PictureMark(symbol: "play.fill")
  let fullscreenMark = PictureMark(symbol: "arrow.up.left.and.arrow.down.right")
  let waiting = UIActivityIndicatorView(style: .medium)

  init() {
    super.init(frame: .zero)
    playerLayer.videoGravity = .resizeAspect
    backgroundColor = .black
    addSubview(caption)
    addSubview(playMark)
    addSubview(waiting)
    addSubview(fullscreenMark)
    waiting.color = .white
    waiting.hidesWhenStopped = true
  }

  required init?(coder: NSCoder) { nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    caption.frame = bounds
    let size: CGFloat = bounds.height < 80 ? 32 : 54
    playMark.frame = CGRect(x: (bounds.width - size) / 2, y: (bounds.height - size) / 2, width: size, height: size)
    waiting.center = CGPoint(x: bounds.midX, y: bounds.midY)
    fullscreenMark.frame = CGRect(x: bounds.maxX - 43, y: 11, width: 32, height: 32)
  }
}

private final class PictureMark: UIView {
  private let image: UIImageView

  init(symbol: String) {
    self.image = UIImageView(image: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(weight: .semibold)))
    super.init(frame: .zero)
    backgroundColor = UIColor(white: 0.07, alpha: 0.67)
    image.contentMode = .scaleAspectFit
    image.tintColor = UIColor(red: 1, green: 0.97, blue: 0.93, alpha: 1)
    addSubview(image)
    isUserInteractionEnabled = false
  }

  required init?(coder: NSCoder) { nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    layer.cornerRadius = bounds.width > 44 ? bounds.width / 2 : 9
    image.frame = bounds.insetBy(dx: bounds.width * 0.28, dy: bounds.height * 0.28)
  }
}

private final class CaptionOverlay: UIView {
  var isFullscreen = false
  /// Text comes from the cue timeline (setText) rather than from the page's layout updates.
  var cueDriven = false
  var didLeaveWindow: (() -> Void)?
  var videoFrame = CGRect.zero { didSet { setNeedsLayout() } }
  private let backing = UIView()
  private let translation = UILabel()
  private let original = UILabel()
  private var style: PodcastVideoLayout?

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    backing.layer.cornerRadius = 10
    addSubview(backing)
    for label in [translation, original] {
      label.numberOfLines = 2
      label.textAlignment = .center
      label.lineBreakMode = .byTruncatingTail
      label.textColor = UIColor(red: 1, green: 0.98, blue: 0.95, alpha: 1)
      label.layer.shadowColor = UIColor.black.cgColor
      label.layer.shadowRadius = 2
      label.layer.shadowOpacity = 1
      label.layer.shadowOffset = CGSize(width: 0, height: 1)
      backing.addSubview(label)
    }
  }

  required init?(coder: NSCoder) { nil }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { didLeaveWindow?() }
  }

  func configure(_ layout: PodcastVideoLayout) {
    style = layout
    if !cueDriven {
      translation.text = layout.translated
      original.text = layout.original
    }
    backing.backgroundColor = layout.boxed ? UIColor(white: 0, alpha: 0.62) : .clear
    setNeedsLayout()
  }

  func setText(translated: String?, original text: String?) {
    guard translation.text != translated || original.text != text else { return }
    translation.text = translated
    original.text = text
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let style, bounds.height >= 85 else { backing.isHidden = true; return }
    let labels = [translation, original].filter { !($0.text ?? "").isEmpty }
    backing.isHidden = labels.isEmpty
    guard !labels.isEmpty else { return }
    let scale = CGFloat(min(1.65, max(0.75, style.scale)))
    let referenceHeight = isFullscreen && !videoFrame.isEmpty ? videoFrame.height : bounds.height
    let base = min(isFullscreen ? 27.0 : 23.0, max(isFullscreen ? 18.0 : 13.0, referenceHeight * 0.063)) * scale
    translation.font = font(base, preferred: style.font, weight: .semibold)
    original.font = font(base * 0.88, preferred: style.font, weight: .medium)
    translation.isHidden = !labels.contains(translation)
    original.isHidden = !labels.contains(original)
    let width = min(bounds.width * 0.93, 760)
    let sizes = labels.map { $0.sizeThatFits(CGSize(width: max(0, width - 16), height: .greatestFiniteMagnitude)) }
    let horizontal = min(width, (sizes.map(\.width).max() ?? 0) + 16)
    let height = sizes.map(\.height).reduce(10, +) + CGFloat(max(0, labels.count - 1)) * 2
    let bottomInset = isFullscreen ? max(72, safeAreaInsets.bottom + 48) : max(6, bounds.height * 0.035)
    let maxY = bounds.height - height - bottomInset
    let yBelowPicture = videoFrame.maxY + 10
    let yCaption = isFullscreen && !videoFrame.isEmpty && yBelowPicture <= maxY ? yBelowPicture : maxY
    backing.frame = CGRect(x: (bounds.width - horizontal) / 2, y: yCaption, width: horizontal, height: height)
    var y: CGFloat = 5
    for (label, size) in zip(labels, sizes) {
      label.frame = CGRect(x: 8, y: y, width: max(0, horizontal - 16), height: size.height)
      y += size.height + 2
    }
  }

  private func font(_ size: CGFloat, preferred: String, weight: UIFont.Weight) -> UIFont {
    if preferred == "serif", let face = UIFont(name: "STSongti-SC-Regular", size: size) { return face }
    if preferred == "kai", let face = UIFont(name: "STKaitiSC-Regular", size: size) { return face }
    return .systemFont(ofSize: size, weight: weight)
  }
}
