import AVFoundation
import Foundation
import Tauri

struct PodcastCommand: Decodable {
  let session: String
  let action: String
  let url: String?
  let value: Double?
  let rate: Double?
  let video: Bool?
  let revision: Int?
  let layout: PodcastVideoLayout?
  let youtubeID: String?
  let youtubeLabels: PodcastYouTubeLabels?
  let cues: [PodcastCue]?
}

/// One subtitle line pair on the episode's timeline (seconds), as the page's overlay would show it.
struct PodcastCue: Decodable {
  let s: Double
  let e: Double
  let zh: String?
  let o: String?
}

/// One selected episode. Preparing an item may fetch and decode audio, but never starts the clock.
final class PodcastAudio {
  private(set) var session = ""
  private(set) var player: AVPlayer?
  private var hasVideo = false
  private var stallTimer: DispatchWorkItem?
  var isSystemVideoFullscreen: (() -> Bool)?
  private var itemStatus: NSKeyValueObservation?
  private var playerStatus: NSKeyValueObservation?
  private var positioning = false
  private var timeStatus: NSKeyValueObservation?
  private var periodic: Any?
  private var notifications = [NSObjectProtocol]()
  private var wantsPlay = false
  private var revision = 0
  private var ready = false
  private var rate: Float = 1
  private var position: Double = 0
  private var lastBuffer: Double = -1
  private var bufferObserver: NSKeyValueObservation?
  var notify: ((JSObject) -> Void)?

  func apply(_ command: PodcastCommand) {
    // A page that just loaded owns no player. After iOS kills the web content process the page loads again with a
    // new session, and the old player would keep playing with nothing on screen to stop it.
    if command.action == "reset" { stop(); session = ""; return }
    if command.action == "prepare" {
      guard let raw = command.url, let url = URL(string: raw),
            ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
      stop()
      session = command.session
      position = max(0, command.value ?? 0)
      rate = Float(command.rate ?? 1)
      let item = AVPlayerItem(url: url)
      hasVideo = command.video == true
      item.preferredForwardBufferDuration = hasVideo ? 12 : 20
      let p = AVPlayer(playerItem: item)
      player = p
      p.automaticallyWaitsToMinimizeStalling = true
      itemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
        DispatchQueue.main.async { self?.prepareIfReady(p) }
      }
      playerStatus = p.observe(\.status, options: [.initial, .new]) { [weak self] _, _ in
        DispatchQueue.main.async { self?.prepareIfReady(p) }
      }
      timeStatus = p.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
        DispatchQueue.main.async {
          guard let self, self.player === p else { return }
          if self.hasVideo && self.ready && self.isSystemVideoFullscreen?() == true {
            self.wantsPlay = p.timeControlStatus != .paused
          }
          self.publish()
        }
      }
      bufferObserver = item.observe(\.loadedTimeRanges, options: [.new]) { [weak self] _, _ in
        DispatchQueue.main.async {
          guard let self = self, self.player === p, self.ready else { return }
          let end = self.bufferEnd()
          if abs(self.lastBuffer - end) >= 1 { self.lastBuffer = end; self.publish() }
        }
      }
      periodic = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 2), queue: .main) { [weak self] _ in
        if self?.player === p { self?.publish() }
      }
      let center = NotificationCenter.default
      notifications.append(center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
        guard let self = self, self.player === p else { return }
        self.wantsPlay = false
        self.publish("ended")
      })
      notifications.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] _ in
        if self?.player === p { self?.publish("failed") }
      })
      notifications.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
        if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
          self?.wantsPlay = false
          self?.player?.pause()
          self?.publish()
        }
      })
      notifications.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
        if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
          self?.wantsPlay = false
          self?.player?.pause()
          self?.publish()
        }
      })
      return
    }
    guard session == command.session, let p = player else { return }
    if let revision = command.revision { self.revision = revision }
    switch command.action {
    case "dispose": stop(); return
    case "pause": wantsPlay = false; p.pause()
    case "toggle" where wantsPlay: wantsPlay = false; p.pause()
    case "toggle", "play": wantsPlay = true; if ready { start() }
    case "seek":
      position = max(0, command.value ?? 0)
      wantsPlay = true
      if ready {
        p.cancelPendingPrerolls()
        p.seek(to: CMTime(seconds: position, preferredTimescale: 600))
        start()
      }
    case "rate": rate = Float(command.value ?? 1); if wantsPlay && ready { p.rate = rate }
    case "mute": p.isMuted = (command.value ?? 0) != 0
    default: return
    }
    publish()
  }

  func returnedToInlineVideo() {
    guard hasVideo, ready, wantsPlay, let player, player.timeControlStatus == .paused else { return }
    start()
    publish()
  }

  private func prepareIfReady(_ p: AVPlayer) {
    guard player === p, let item = p.currentItem else { return }
    if item.status == .failed || p.status == .failed { publish("failed"); return }
    guard p.status == .readyToPlay, item.status == .readyToPlay, !ready, !positioning else { return }
    let duration = item.duration.seconds
    if duration.isFinite && position >= duration - 1 { position = 0 }
    let target = position
    let finish = {
      guard self.player === p else { return }
      self.positioning = false
      if self.position != target { self.prepareIfReady(p); return }
      self.ready = true
      self.stallTimer?.cancel()
      self.stallTimer = nil
      if self.wantsPlay { self.start() }
      else if p.status == .readyToPlay && p.rate == 0 { p.preroll(atRate: self.rate) { _ in } }
      self.publish()
    }
    if target > 0 {
      positioning = true
      p.seek(to: CMTime(seconds: target, preferredTimescale: 600)) { _ in DispatchQueue.main.async { finish() } }
    } else { finish() }
  }

  private func start() {
    guard let p = player else { return }
    p.cancelPendingPrerolls()
    try? AVAudioSession.sharedInstance().setActive(true)
    if let duration = p.currentItem?.duration.seconds, duration.isFinite, p.currentTime().seconds >= duration - 0.1 {
      p.seek(to: .zero)
    }
    p.rate = rate
  }

  private func bufferEnd() -> Double {
    guard let p = player else { return 0 }
    let time = p.currentTime().seconds
    for value in p.currentItem?.loadedTimeRanges ?? [] {
      let range = value.timeRangeValue
      if range.start.seconds <= time + 0.1 && range.end.seconds >= time { return range.end.seconds }
    }
    return 0
  }

  private func publish(_ event: String = "") {
    guard let p = player else { return }
    let time = ready ? p.currentTime().seconds : position
    let duration = p.currentItem?.duration.seconds ?? 0
    let playing = p.timeControlStatus == .playing
    let buffered = bufferEnd()
    let waiting = wantsPlay && !playing
    if hasVideo && waiting && event != "failed" {
      if stallTimer == nil {
        let timer = DispatchWorkItem { [weak self, weak p] in
          guard let self, let p, self.player === p, self.wantsPlay, p.timeControlStatus != .playing else { return }
          self.publish("failed")
        }
        stallTimer = timer
        // Opening a progressive file can require several metadata ranges before the first seek.
        DispatchQueue.main.asyncAfter(deadline: .now() + (ready ? 11 : 24), execute: timer)
      }
    } else {
      stallTimer?.cancel()
      stallTimer = nil
    }
    notify?(["session": session, "event": event, "time": time.isFinite ? time : 0,
             "duration": duration.isFinite ? duration : 0, "buffer": buffered.isFinite ? buffered : 0,
             "playing": playing, "waiting": waiting, "revision": revision])
  }

  private func stop() {
    stallTimer?.cancel(); stallTimer = nil
    itemStatus = nil; playerStatus = nil; timeStatus = nil; bufferObserver = nil
    if let observer = periodic { player?.removeTimeObserver(observer) }
    notifications.forEach { NotificationCenter.default.removeObserver($0) }
    notifications.removeAll()
    periodic = nil
    player?.cancelPendingPrerolls()
    player?.pause()
    player?.replaceCurrentItem(with: nil)
    player = nil; ready = false; positioning = false; wantsPlay = false; lastBuffer = -1; hasVideo = false; revision = 0
  }
}
