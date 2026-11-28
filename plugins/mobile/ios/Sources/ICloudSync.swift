// [INPUT]: 使用 UIKit 文件夹选择器和 Foundation 的 iCloud 文件协调。
// [OUTPUT]: 查询容器状态，选定同步文件夹，读写同步文件。
// [POS]: 为 MobilePlugin 的 iCloud 命令提供原生存储。
// [PROTOCOL]: Update this header on change, then check AGENTS.md

import Foundation
import UIKit
import UniformTypeIdentifiers

struct ICloudStatusPayload: Encodable {
  let available: Bool
  let configured: Bool
  let mode: String
  let path: String
  let hasFile: Bool
}

struct ICloudReadPayload: Encodable {
  let content: String?
}

struct ICloudRelPathArgs: Decodable {
  let relPath: String
}

struct ICloudWriteArgs: Decodable {
  let relPath: String
  let content: String
}

/// Manages SubCast's native iCloud Documents container (with optional Security-Scoped folder fallback)
/// and coordinated atomic file I/O for `subcast-sync.json` and `episodes/<episode_id>.json`.
final class ICloudSync: NSObject, UIDocumentPickerDelegate {
  static let shared = ICloudSync()
  private let containerIdentifier = "iCloud.ai.qiaomu.subcast"
  private let bookmarkKey = "subcast.icloud.folderBookmark"
  private let syncFileName = "subcast-sync.json"
  private var pickCompletion: ((Result<ICloudStatusPayload, Error>?) -> Void)?

  private override init() {
    super.init()
  }

  private func resolveBookmarkedURL() -> URL? {
    guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
    var isStale = false
    guard let url = try? URL(
      resolvingBookmarkData: data,
      options: [],
      relativeTo: nil,
      bookmarkDataIsStale: &isStale
    ) else {
      return nil
    }
    if isStale {
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      if let refreshed = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
        UserDefaults.standard.set(refreshed, forKey: bookmarkKey)
      }
    }
    return url
  }

  private func resolveContainerURL() -> URL? {
    guard let base = FileManager.default.url(forUbiquityContainerIdentifier: containerIdentifier)
      ?? FileManager.default.url(forUbiquityContainerIdentifier: nil) else {
      return nil
    }
    let docs = base.appendingPathComponent("Documents", isDirectory: true)
    try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
    return docs
  }

  private func activeFolder() -> (url: URL, mode: String)? {
    if let url = resolveContainerURL() {
      return (url, "container")
    }
    if let url = resolveBookmarkedURL() {
      return (url, "folder")
    }
    return nil
  }

  func status() -> ICloudStatusPayload {
    guard let (url, mode) = activeFolder() else {
      if FileManager.default.ubiquityIdentityToken == nil {
        return ICloudStatusPayload(available: false, configured: false, mode: "unavailable", path: "", hasFile: false)
      }
      return ICloudStatusPayload(available: true, configured: false, mode: "picker", path: "", hasFile: false)
    }
    let scoped = mode == "folder" ? url.startAccessingSecurityScopedResource() : false
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let fileURL = url.appendingPathComponent(syncFileName)
    let stubURL = url.appendingPathComponent(".\(syncFileName).icloud")
    if mode == "container" && !FileManager.default.fileExists(atPath: fileURL.path) && FileManager.default.fileExists(atPath: stubURL.path) {
      try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
    }
    let hasFile = FileManager.default.fileExists(atPath: fileURL.path) || FileManager.default.fileExists(atPath: stubURL.path)
    let displayPath = mode == "container"
      ? "iCloud 云盘 / SubCast"
      : (url.lastPathComponent.isEmpty ? url.path : url.lastPathComponent)
    return ICloudStatusPayload(
      available: true,
      configured: true,
      mode: mode,
      path: displayPath,
      hasFile: hasFile
    )
  }

  func clearFolder() -> ICloudStatusPayload {
    UserDefaults.standard.removeObject(forKey: bookmarkKey)
    return status()
  }

  func pickFolder(from presenter: UIViewController, completion: @escaping (Result<ICloudStatusPayload, Error>?) -> Void) {
    DispatchQueue.main.async {
      if self.pickCompletion != nil {
        completion(.failure(NSError(domain: "SubCastICloud", code: 1, userInfo: [NSLocalizedDescriptionKey: "正在选择目录，请稍候"])))
        return
      }
      self.pickCompletion = completion
      let picker: UIDocumentPickerViewController
      if #available(iOS 14.0, *) {
        picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      } else {
        picker = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
      }
      picker.allowsMultipleSelection = false
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let cb = pickCompletion
    pickCompletion = nil
    guard let url = urls.first else {
      cb?(nil)
      return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let isUbiquitous = (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
    let path = url.path
    let inCloudDocs = path.contains("CloudDocs") || path.contains("Mobile Documents")
    if !isUbiquitous && !inCloudDocs {
      cb?(.failure(NSError(domain: "SubCastICloud", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "请选择「iCloud 云盘」里的文件夹，不要选「我的 iPhone」本地目录"
      ])))
      return
    }
    do {
      let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      UserDefaults.standard.set(data, forKey: bookmarkKey)
      cb?(.success(status()))
    } catch {
      cb?(.failure(error))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let cb = pickCompletion
    pickCompletion = nil
    cb?(nil)
  }

  private func sanitizeRelPath(_ relPath: String) throws -> [String] {
    let parts = relPath.split(separator: "/").map(String.init).filter { !$0.isEmpty }
    guard !parts.isEmpty else {
      throw NSError(domain: "SubCastICloud", code: 2, userInfo: [NSLocalizedDescriptionKey: "同步路径无效"])
    }
    for part in parts {
      if part == "." || part == ".." {
        throw NSError(domain: "SubCastICloud", code: 2, userInfo: [NSLocalizedDescriptionKey: "同步路径无效"])
      }
    }
    return parts
  }

  func readFile(relPath: String) throws -> String? {
    guard let (baseURL, mode) = activeFolder() else {
      throw NSError(domain: "SubCastICloud", code: 3, userInfo: [NSLocalizedDescriptionKey: "请先在设置里选择 iCloud 云盘同步文件夹"])
    }
    let parts = try sanitizeRelPath(relPath)
    let scoped = mode == "folder" ? baseURL.startAccessingSecurityScopedResource() : false
    defer { if scoped { baseURL.stopAccessingSecurityScopedResource() } }

    var fileURL = baseURL
    for p in parts { fileURL.appendPathComponent(p) }

    let parentURL = fileURL.deletingLastPathComponent()
    let stubURL = parentURL.appendingPathComponent(".\(fileURL.lastPathComponent).icloud")
    let dlStatus = (try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
    if !FileManager.default.fileExists(atPath: fileURL.path)
      && (FileManager.default.fileExists(atPath: stubURL.path) || dlStatus == .notDownloaded) {
      try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
      for _ in 0..<24 {
        if FileManager.default.fileExists(atPath: fileURL.path) {
          break
        }
        Thread.sleep(forTimeInterval: 0.25)
      }
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw NSError(domain: "SubCastICloud", code: 5, userInfo: [
          NSLocalizedDescriptionKey: "iCloud 正在下载同步文件，请稍后再试"
        ])
      }
    }

    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordError: NSError?
    var innerError: Error?
    var text: String?
    coordinator.coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
      do {
        if FileManager.default.fileExists(atPath: url.path) {
          text = try String(contentsOf: url, encoding: .utf8)
        }
      } catch let err as NSError where err.domain == NSCocoaErrorDomain && err.code == NSFileReadNoSuchFileError {
        text = nil
      } catch {
        innerError = error
      }
    }
    if let err = coordError ?? innerError {
      let ns = err as NSError
      if ns.domain == NSCocoaErrorDomain && ns.code == NSFileReadNoSuchFileError {
        return nil
      }
      throw err
    }
    return text
  }

  func writeFile(relPath: String, content: String) throws {
    guard let (baseURL, mode) = activeFolder() else {
      throw NSError(domain: "SubCastICloud", code: 3, userInfo: [NSLocalizedDescriptionKey: "请先在设置里选择 iCloud 云盘同步文件夹"])
    }
    let parts = try sanitizeRelPath(relPath)
    let scoped = mode == "folder" ? baseURL.startAccessingSecurityScopedResource() : false
    defer { if scoped { baseURL.stopAccessingSecurityScopedResource() } }

    var fileURL = baseURL
    for p in parts { fileURL.appendPathComponent(p) }
    let parentURL = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parentURL, withIntermediateDirectories: true)

    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordError: NSError?
    var innerError: Error?
    coordinator.coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordError) { url in
      do {
        try content.write(to: url, atomically: true, encoding: .utf8)
      } catch {
        innerError = error
      }
    }
    if let err = coordError ?? innerError {
      throw err
    }
  }
}
