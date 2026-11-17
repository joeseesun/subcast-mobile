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

  override func load(webview: WKWebView) {
    // .playback keeps the web view's <audio> going with the screen locked or the app in the background
    // (with UIBackgroundModes = audio in Info.plist) and ignores the mute switch, like any podcast app.
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .spokenAudio, options: [])
    try? session.setActive(true)
    webview.configuration.allowsInlineMediaPlayback = true
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
