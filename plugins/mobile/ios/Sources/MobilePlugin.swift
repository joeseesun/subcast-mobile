import AVFoundation
import Foundation
import MediaPlayer
import SwiftRs
import Tauri
import UIKit
import WebKit

struct ShareArgs: Decodable {
  let text: String?
  let path: String?
  let mime: String?
  let title: String?
}

struct NowPlayingArgs: Decodable {
  let title: String
  let artist: String?
  let artwork: String?
  let duration: Double?
  let position: Double?
  let rate: Double?
  let playing: Bool
}

/// Background audio, lock-screen controls and the share sheet for SubCast's web view.
class MobilePlugin: Plugin {
  private var artworkURL: String?
  private var artwork: MPMediaItemArtwork?
  private var commandsReady = false
  private var interruptions: [NSObjectProtocol] = []
  private weak var podcastWebView: WKWebView?

  override func load(webview: WKWebView) {
    podcastWebView = webview
    // .playback keeps the web view's <audio> going with the screen locked or the app in the background
    // (with UIBackgroundModes = audio in Info.plist) and ignores the mute switch, like any podcast app.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .spokenAudio, options: [])
    try? session.setActive(true)
    webview.configuration.allowsInlineMediaPlayback = true
    if interruptions.isEmpty {
      let center = NotificationCenter.default
      interruptions.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
        if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
          self?.trigger("remote", data: ["action": "interruption"])
        }
      })
      interruptions.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
        if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
          self?.trigger("remote", data: ["action": "interruption"])
        }
      })
    }
  }

  deinit {
    interruptions.forEach { NotificationCenter.default.removeObserver($0) }
  }

  private let podcast = PodcastAudio()
  private let podcastVideo = PodcastVideoSurface()
  private var glassDock: AnyObject?

  @objc public func updateGlassDock(_ invoke: Invoke) throws {
    guard #available(iOS 26.0, *) else { invoke.resolve(false); return }
    let state = try invoke.parseArgs(GlassDockState.self)
    DispatchQueue.main.async {
      guard let parent = self.manager.viewController else { invoke.resolve(false); return }
      let dock = (self.glassDock as? GlassDock) ?? GlassDock()
      self.glassDock = dock
      dock.update(state, in: parent) { [weak self] action, id in
        self?.trigger("glass-dock-action", data: ["action": action, "id": id])
      }
      invoke.resolve(true)
    }
  }

  @objc public func podcastAudio(_ invoke: Invoke) throws {
    let command = try invoke.parseArgs(PodcastCommand.self)
    DispatchQueue.main.async {
      switch command.action {
      case "present-embed":
        guard let host = self.manager.viewController, host.presentedViewController == nil,
              host.viewIfLoaded?.window != nil, let id = command.youtubeID, let labels = command.youtubeLabels,
              let player = PodcastYouTubePlayer(videoID: id, time: command.value ?? 0, labels: labels,
                                                finish: { invoke.resolve($0) }) else {
          invoke.reject("The YouTube player is unavailable")
          return
        }
        let navigation = UINavigationController(rootViewController: player)
        navigation.overrideUserInterfaceStyle = .dark
        navigation.modalPresentationStyle = .fullScreen
        host.present(navigation, animated: true)
        return
      case "video-layout":
        if self.podcast.session == command.session, let layout = command.layout {
          self.podcastVideo.update(layout)
        }
      case "video-cues":
        if self.podcast.session == command.session { self.podcastVideo.setCues(command.cues ?? []) }
      case "video-fullscreen":
        guard self.podcast.session == command.session, let controller = self.manager.viewController,
              self.podcastVideo.showFullscreen(from: controller) else {
          invoke.reject("Full-screen video is unavailable")
          return
        }
      default:
        if command.action == "prepare" || (command.action == "dispose" && self.podcast.session == command.session) {
          self.podcastVideo.stop()
        }
        self.podcastVideo.didReturnInline = { [weak self] in self?.podcast.returnedToInlineVideo() }
        self.podcast.isSystemVideoFullscreen = { [weak self] in self?.podcastVideo.isFullscreen ?? false }
        self.podcast.notify = { [weak self] data in
          if let playing = data["playing"] as? Bool, let waiting = data["waiting"] as? Bool {
            self?.podcastVideo.setTransport(playing: playing, waiting: waiting)
          }
          self?.trigger("podcast", data: data)
        }
        self.podcast.apply(command)
        if command.action == "prepare", command.video == true {
          guard command.session == self.podcast.session, let player = self.podcast.player,
                let webView = self.podcastWebView, let root = self.manager.viewController?.view else {
            invoke.reject("Inline video is unavailable")
            return
          }
          self.podcastVideo.attach(player, webView: webView, host: root)
        }
      }
      invoke.resolve()
    }
  }

  @objc public func presentSettingsIndex(_ invoke: Invoke) throws {
    let state = try invoke.parseArgs(SettingsIndexState.self)
    DispatchQueue.main.async {
      guard let parent = self.manager.viewController, parent.presentedViewController == nil,
            parent.viewIfLoaded?.window != nil else { invoke.resolve(); return }
      let settings = SettingsIndex(state: state) { choice in invoke.resolve(choice) }
      let navigation = UINavigationController(rootViewController: settings)
      navigation.navigationBar.prefersLargeTitles = state.choiceSheet != true
      navigation.view.tintColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(red: 1, green: 0.62, blue: 0.43, alpha: 1)
          : UIColor(red: 0.72, green: 0.21, blue: 0.03, alpha: 1)
      }
      navigation.modalPresentationStyle = state.choiceSheet == true ? .pageSheet : .fullScreen
      if state.choiceSheet == true, let sheet = navigation.sheetPresentationController {
        if #available(iOS 16.0, *) {
          let rowCount = state.groups.reduce(0) { $0 + $1.count }
          let height: CGFloat = rowCount <= 3 ? CGFloat(124 + 48 * rowCount) : 450
          sheet.detents = [.custom { min(height, $0.maximumDetentValue * 0.85) }, .large()]
        } else {
          sheet.detents = [.medium(), .large()]
        }
        sheet.prefersGrabberVisible = true
        sheet.delegate = settings
      }
      parent.present(navigation, animated: true)
    }
  }

  private lazy var selectionGenerator = UISelectionFeedbackGenerator()

  @objc public func selectionFeedback(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.selectionGenerator.selectionChanged()
      self.selectionGenerator.prepare()
      invoke.resolve()
    }
  }

  private func setUpCommands() {
    if commandsReady { return }
    commandsReady = true
    let center = MPRemoteCommandCenter.shared()
    let send: (String, Double?) -> Void = { [weak self] action, position in
      var data: JSObject = ["action": action]
      if let p = position { data["position"] = p }
      self?.trigger("remote", data: data)
    }
    center.playCommand.addTarget { _ in send("play", nil); return .success }
    center.pauseCommand.addTarget { _ in send("pause", nil); return .success }
    center.togglePlayPauseCommand.addTarget { _ in send("toggle", nil); return .success }
    center.skipForwardCommand.preferredIntervals = [30]
    center.skipForwardCommand.addTarget { _ in send("forward", nil); return .success }
    center.skipBackwardCommand.preferredIntervals = [15]
    center.skipBackwardCommand.addTarget { _ in send("back", nil); return .success }
    center.changePlaybackPositionCommand.addTarget { event in
      guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      send("seek", e.positionTime)
      return .success
    }
    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false
  }

  @objc public func nowPlaying(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(NowPlayingArgs.self)
    DispatchQueue.main.async {
      self.setUpCommands()
      if args.playing { try? AVAudioSession.sharedInstance().setActive(true) }
      var info: [String: Any] = [
        MPMediaItemPropertyTitle: args.title,
        MPNowPlayingInfoPropertyElapsedPlaybackTime: args.position ?? 0,
        MPNowPlayingInfoPropertyPlaybackRate: args.playing ? (args.rate ?? 1) : 0,
        MPNowPlayingInfoPropertyDefaultPlaybackRate: args.rate ?? 1,
      ]
      if let a = args.artist { info[MPMediaItemPropertyArtist] = a }
      if let d = args.duration, d > 0 { info[MPMediaItemPropertyPlaybackDuration] = d }
      if let art = self.artwork, self.artworkURL == args.artwork { info[MPMediaItemPropertyArtwork] = art }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      if #available(iOS 13.0, *) { MPNowPlayingInfoCenter.default().playbackState = args.playing ? .playing : .paused }
      if let url = args.artwork, url != self.artworkURL { self.loadArtwork(url) }
    }
    invoke.resolve()
  }

  private func loadArtwork(_ url: String) {
    artworkURL = url
    artwork = nil
    guard let u = URL(string: url) else { return }
    URLSession.shared.dataTask(with: u) { data, _, _ in
      guard let data = data, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async {
        guard self.artworkURL == url else { return }
        let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        self.artwork = art
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = art
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      }
    }.resume()
  }

  @objc public func clearNowPlaying(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      if #available(iOS 13.0, *) { MPNowPlayingInfoCenter.default().playbackState = .stopped }
    }
    invoke.resolve()
  }

  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    var items: [Any] = []
    if let path = args.path {
      let url = URL(fileURLWithPath: path)
      if args.mime?.hasPrefix("image/") == true, let image = UIImage(contentsOfFile: path) { items.append(image) } else { items.append(url) }
    }
    if let text = args.text {
      // Long text (an OPML export) goes as a file, so it can be saved to Files or sent to another app.
      if text.count > 2000, let title = args.title {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(title)
        try? text.write(to: url, atomically: true, encoding: .utf8)
        items.append(url)
      } else {
        items.append(text)
      }
    }
    if items.isEmpty { invoke.reject("nothing to share"); return }
    DispatchQueue.main.async {
      guard let vc = self.manager.viewController else { invoke.reject("no view"); return }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      // iPad shows it as a popover, which needs an anchor.
      if let pop = sheet.popoverPresentationController {
        pop.sourceView = vc.view
        pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 80, width: 1, height: 1)
        pop.permittedArrowDirections = []
      }
      sheet.completionWithItemsHandler = { _, _, _, _ in invoke.resolve() }
      vc.present(sheet, animated: true)
    }
  }
}

@_cdecl("init_plugin_mobile")
public func initPlugin() -> Plugin {
  return MobilePlugin()
}
