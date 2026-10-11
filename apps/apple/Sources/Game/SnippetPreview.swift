import Combine
import EraticCore
import SwiftUI

/// Plays timed snippets from a provider's hidden preview (Snippet Ladder without exact clips).
/// Spotify uses the hidden web player's bridge, Apple Music the hidden preview file; both stop by themselves.
/// Independently implemented using public embeds; see docs/ATTRIBUTION.md.
@MainActor
final class SnippetController: ObservableObject {
    /// Same vocabulary as the previews: loading, ready, starting, playing, paused, unavailable, error.
    @Published private(set) var status = "loading"
    @Published private(set) var command = PreviewCommand()
    @Published private(set) var attempt = UUID()
    @Published private(set) var track: ProviderTrack?
    private var url: URL?
    private let apple = ApplePreviewPlayer()
    private var observation: AnyCancellable?
    /// Spotify only: runs once when the pending snippet's sound starts.
    private var audible: (() -> Void)?

    init() {
        observation = apple.$status.sink { [weak self] status in
            guard let self, self.track?.provider != .spotify else { return }
            self.status = status
        }
    }

    /// Whether `snippet` can start now. A snippet in flight may be replaced; one still starting may not.
    var canPlay: Bool { ["ready", "paused", "playing"].contains(status) }
    /// The preview can't be used, so the host plays steps by hand.
    var failed: Bool { status == "unavailable" || status == "error" }

    /// Loads the song's preview without playing it. Loading the same URL again is a no-op.
    func load(_ url: URL) {
        guard self.url != url else { return }
        unload()
        guard let track = ScanRules.providerTrack(url.absoluteString) else { status = "unavailable"; return }
        self.url = url
        self.track = track
        status = "loading"
        if track.provider == .spotify {
            command = PreviewCommand()
            attempt = UUID()
        } else {
            apple.load(id: track.id, storefront: track.storefront ?? "us", autoplay: false)
        }
    }

    /// Stops and forgets the preview, unless `url` isn't the loaded one (a newer card already replaced it).
    func unload(ifLoaded url: URL) {
        guard self.url == url else { return }
        unload()
    }

    private func unload() {
        apple.dispose()
        audible = nil
        url = nil
        track = nil
        status = "loading"
    }

    /// Plays `lengthMs` from `seconds`, then stops by itself. `onAudible` runs once, when sound starts.
    func snippet(from seconds: Double, lengthMs: Int, onAudible: @escaping () -> Void) {
        guard canPlay, let track else { return }
        if track.provider == .spotify {
            audible = onAudible
            status = "starting"
            command = PreviewCommand(action: "snippet", seconds: seconds, ms: lengthMs)
        } else {
            apple.snippet(from: seconds, lengthMs: lengthMs, onAudible: onAudible)
        }
    }

    /// Stops a snippet in flight.
    func stop() {
        guard let track else { return }
        audible = nil
        if track.provider == .spotify {
            status = "paused"
            command = PreviewCommand(action: "pause")
        } else { apple.pause() }
    }

    fileprivate func spotifyReport(_ state: String) {
        guard track?.provider == .spotify else { return }
        status = state
    }

    fileprivate func spotifyAudible() {
        let handler = audible
        audible = nil
        handler?()
    }
}

/// The hidden preview behind `SnippetController`: nothing to see or hear until a snippet starts.
struct SnippetPreview: View {
    @ObservedObject var controller: SnippetController
    let url: URL

    var body: some View {
        Group {
            if let track = controller.track, track.provider == .spotify {
                PreviewWebView(track: track, url: url, command: controller.command, autoplay: false,
                               report: { controller.spotifyReport($0) },
                               progress: { _, _ in },
                               snippetAudible: { controller.spotifyAudible() })
                    .id(controller.attempt)
                    .frame(height: 1)
                    .opacity(0)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            } else {
                Color.clear.frame(height: 0).accessibilityHidden(true)
            }
        }
        .onAppear { controller.load(url) }
        .onDisappear { controller.unload(ifLoaded: url) }
    }
}
