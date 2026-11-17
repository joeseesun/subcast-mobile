import SwiftUI
import UIKit

struct GlassDockState: Decodable, Equatable {
  struct Tab: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
  }

  struct Player: Decodable, Equatable {
    let id: String
    let title: String
    let show: String?
    let artwork: URL?
    let playLabel: String
    let isPlaying: Bool
    let isLoading: Bool
    let canPlay: Bool
    let progress: Double
  }

  let visible: Bool
  let tabs: [Tab]
  let selected: String
  let player: Player?
}

@available(iOS 26.0, *)
final class GlassDock {
  private let model = Model()
  private var host: UIHostingController<Dock>?
  private var height: NSLayoutConstraint?

  final class Model: ObservableObject {
    @Published var state: GlassDockState?
  }

  func update(_ state: GlassDockState, in parent: UIViewController, action: @escaping (String, String) -> Void) {
    guard state.visible, !state.tabs.isEmpty || state.player != nil else {
      host?.view.isHidden = true
      return
    }
    if model.state != state { model.state = state }
    if host == nil {
      let controller = UIHostingController(rootView: Dock(model: model, action: action))
      controller.safeAreaRegions = []
      controller.view.backgroundColor = .clear
      controller.view.translatesAutoresizingMaskIntoConstraints = false
      parent.addChild(controller)
      parent.view.addSubview(controller.view)
      let safe = parent.view.safeAreaLayoutGuide
      let preferredWidth = controller.view.widthAnchor.constraint(equalTo: safe.widthAnchor, constant: -24)
      preferredWidth.priority = .defaultHigh
      let height = controller.view.heightAnchor.constraint(equalToConstant: 0)
      NSLayoutConstraint.activate([
        controller.view.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
        controller.view.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -4),
        controller.view.widthAnchor.constraint(lessThanOrEqualToConstant: 500),
        preferredWidth,
        height
      ])
      controller.didMove(toParent: parent)
      self.height = height
      host = controller
    }
    let hasTabs = !state.tabs.isEmpty
    let hasPlayer = state.player != nil
    height?.constant = (hasTabs ? 56 : 0) + (hasPlayer ? 58 : 0) + (hasTabs && hasPlayer ? 7 : 0)
    host?.view.isHidden = false
    if let view = host?.view { parent.view.bringSubviewToFront(view) }
  }
}

@available(iOS 26.0, *)
private struct Dock: View {
  @ObservedObject var model: GlassDock.Model
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme
  @Namespace private var selection
  let action: (String, String) -> Void

  private var accent: Color {
    colorScheme == .dark ? Color(red: 1, green: 0.57, blue: 0.39) : Color(red: 0.73, green: 0.20, blue: 0.02)
  }

  var body: some View {
    if let state = model.state {
      GlassEffectContainer(spacing: 6) {
        VStack(spacing: 7) {
          if let player = state.player { miniPlayer(player) }
          if !state.tabs.isEmpty { navigation(state) }
        }
      }
    }
  }

  private func navigation(_ state: GlassDockState) -> some View {
    HStack(spacing: 0) {
      ForEach(state.tabs) { tab in
        let current = tab.id == state.selected
        Button {
          if !current { UISelectionFeedbackGenerator().selectionChanged() }
          action("tab", tab.id)
        } label: {
          VStack(spacing: 2) {
            Image(systemName: symbol(tab.id, selected: current))
              .font(.system(size: 19, weight: .medium))
              .accessibilityHidden(true)
            Text(tab.title)
              .font(.caption2.weight(current ? .semibold : .medium))
              .lineLimit(1)
          }
          .foregroundStyle(current ? accent : Color.primary)
          .frame(maxWidth: .infinity)
          .frame(height: 48)
          .contentShape(.capsule)
          .background {
            if current {
              Capsule().fill(Color.primary.opacity(0.09))
                .matchedGeometryEffect(id: "active", in: selection)
            }
          }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(current ? .isSelected : [])
      }
    }
    .padding(4)
    .glassEffect(.regular.interactive())
    .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: state.selected)
  }

  private func symbol(_ id: String, selected: Bool) -> String {
    switch id {
    case "latest": return selected ? "house.fill" : "house"
    case "discover": return "safari"
    default: return selected ? "books.vertical.fill" : "books.vertical"
    }
  }

  private func miniPlayer(_ player: GlassDockState.Player) -> some View {
    HStack(spacing: 6) {
      Button { action("open", player.id) } label: {
        HStack(spacing: 10) {
          AsyncImage(url: player.artwork) { phase in
            if let image = phase.image {
              image.resizable().scaledToFill()
            } else {
              Image(systemName: "waveform").frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.primary.opacity(0.07))
            }
          }
          .frame(width: 40, height: 40)
          .clipShape(.rect(cornerRadius: 10))
          .accessibilityHidden(true)

          VStack(alignment: .leading, spacing: 3) {
            Text(player.title).font(.subheadline.weight(.semibold)).lineLimit(1)
            if let show = player.show { Text(show).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            if player.progress > 0 {
              GeometryReader { bar in
                Capsule().fill(Color.primary.opacity(0.09))
                  .overlay(alignment: .leading) {
                    Capsule().fill(accent)
                      .frame(width: bar.size.width * min(1, max(0, player.progress)))
                  }
              }
              .frame(height: 2)
              .accessibilityHidden(true)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 46)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .combine)

      Button { action("play", player.id) } label: {
        Group {
          if player.isLoading { ProgressView().controlSize(.small) }
          else { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 19, weight: .semibold)) }
        }
        .frame(width: 46, height: 46)
        .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .disabled(!player.canPlay)
      .accessibilityLabel(player.playLabel)
    }
    .padding(.leading, 9)
    .padding(.trailing, 6)
    .frame(height: 58)
    .glassEffect(.regular.interactive())
  }
}
