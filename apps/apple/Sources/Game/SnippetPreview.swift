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

/// A tile's snippet button: *Play A*, "Loading A…" while its preview loads, *Stop A* with "Starting…" or "Playing".
struct SnippetTileButton: View {
    @ObservedObject var snippets: TileSnippets
    let index: Int
    var label: String? = nil

    var body: some View {
        let letter = label ?? tileLetter(index)
        let active = snippets.playing == index
        VStack(alignment: .leading, spacing: 4) {
            if snippets.waiting == index {
                Button("Loading \(letter)…") {}
                    .buttonStyle(.borderedProminent)
                    .disabled(true)
            } else {
                Button(active ? "Stop \(letter)" : "Play \(letter)") { snippets.press(index) }
                    .buttonStyle(.borderedProminent)
                    .disabled(!active && snippets.busy)
            }
            if active {
                Text(snippets.isPlaying(index) ? "Playing" : "Starting…").font(.caption)
            }
        }
    }
}

/// Preview snippets for a row of tiles (Lineup, Original or Imposter without exact clips), one loaded preview at a
/// time. The first tile's preview loads (without playing) when the set is drawn; pressing a tile whose preview isn't
/// loaded loads it and plays once ready; after a snippet ends, the next unplayed tile preloads.
@MainActor
final class TileSnippets: ObservableObject {
    let controller = SnippetController()
    /// The tile whose preview is loaded or loading.
    @Published private(set) var loaded: Int?
    /// The tile whose snippet is starting or playing.
    @Published private(set) var playing: Int?
    /// A tile pressed while its preview loads; it plays once ready.
    @Published private(set) var waiting: Int?
    /// Tiles whose preview was unavailable or failed to load before it was heard; Lineup shows their titles instead.
    @Published private(set) var failed: Set<Int> = []
    private var urls: [Int: URL] = [:]
    private var lengthMs = 10_000
    private var played: Set<Int> = []
    private var heard = false
    private var watchdog: Task<Void, Never>?
    private var observations: Set<AnyCancellable> = []

    init() {
        controller.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }.store(in: &observations)
        // Delivered after the change, so `controller.status` is current and a stale event reads the latest state.
        controller.$status.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.statusChanged() }.store(in: &observations)
    }

    /// The loaded tile's preview link, for `SnippetPreview`.
    var url: URL? { loaded.flatMap { urls[$0] } }

    /// The tiles with a snippet, by index, and the snippet's length. Loads the first one; later calls keep the state.
    func configure(urls: [Int: URL], lengthMs: Int) {
        guard self.urls.isEmpty, !urls.isEmpty else { return }
        self.urls = urls
        self.lengthMs = lengthMs
        if let first = urls.keys.min() { switchTo(first) }
    }

    func hasSnippet(_ index: Int) -> Bool { urls[index] != nil }

    func isPlaying(_ index: Int) -> Bool { playing == index && controller.status == "playing" }

    /// The tile's preview is loading for a press, or its snippet is starting.
    func isLoading(_ index: Int) -> Bool { waiting == index || (playing == index && controller.status == "starting") }

    /// A tile is loading or starting, so the others wait.
    var busy: Bool { waiting != nil || (playing != nil && controller.status == "starting") }

    /// A problem with the loaded tile's preview, in words.
    var problem: String? {
        guard let loaded, controller.failed else { return nil }
        let letter = tileLetter(loaded)
        return controller.status == "unavailable" ? "No hidden preview is available for \(letter). Use its backup below."
            : "\(letter)'s preview could not play. Try again, or use its backup below."
    }

    /// Plays the tile's snippet, loading its preview first when needed; while it plays or starts, stops it.
    func press(_ index: Int) {
        guard let url = urls[index] else { return }
        if playing == index { stop(); return }
        guard !busy else { return }
        if loaded == index, controller.canPlay {
            start(index, fresh: true)
        } else {
            // A failed preview of the same tile is loaded afresh.
            if loaded == index { controller.unload(ifLoaded: url) }
            failed.remove(index)
            // Another tile's snippet must not read as playing, or be stopped by a press, while this one loads.
            watchdog?.cancel()
            playing = nil
            switchTo(index)
            waiting = index
        }
    }

    func stop() {
        watchdog?.cancel()
        waiting = nil
        playing = nil
        controller.stop()
    }

    private func switchTo(_ index: Int) {
        guard let url = urls[index] else { return }
        loaded = index
        controller.load(url)
    }

    private func start(_ index: Int, fresh: Bool) {
        playing = index
        heard = false
        controller.snippet(from: 0, lengthMs: lengthMs) { [weak self] in
            self?.heard = true
            self?.played.insert(index)
        }
        watchdog?.cancel()
        guard !fresh else { return }
        // Started without a fresh press: if it stays silent, offer Play again rather than staying on "Starting…".
        watchdog = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, let self, self.playing == index, self.controller.status == "starting" else { return }
            self.stop()
        }
    }

    private func statusChanged() {
        let status = controller.status
        if let loaded {
            if controller.failed, !played.contains(loaded), !failed.contains(loaded) {
                failed.insert(loaded)
            } else if controller.canPlay, failed.contains(loaded) {
                failed.remove(loaded)
            }
        }
        if let waiting, loaded == waiting {
            if controller.canPlay {
                self.waiting = nil
                start(waiting, fresh: false)
                return
            }
            if controller.failed { self.waiting = nil }
        }
        if let playing, ["ready", "paused", "unavailable", "error"].contains(status) {
            watchdog?.cancel()
            self.playing = nil
            if heard { preloadNext(after: playing) }
        }
    }

    /// The next tile not heard yet, after `index` and wrapping round.
    private func preloadNext(after index: Int) {
        let order = urls.keys.sorted()
        let next = order.first { $0 > index && !played.contains($0) } ?? order.first { !played.contains($0) }
        guard let next, next != loaded else { return }
        switchTo(next)
    }
}
