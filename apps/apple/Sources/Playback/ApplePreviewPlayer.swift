import AVFoundation
import Combine
import Foundation

/// Hidden Apple Music preview with host transport controls.
/// Apple has no documented control API for its embed; the public iTunes Lookup API's
/// 30 s preview file gives transport control without revealing the song. Only the
/// preview URL is kept: no song metadata ever reaches the UI.
@MainActor
final class ApplePreviewPlayer: ObservableObject {
    /// Same vocabulary as the Spotify bridge: loading, ready, starting, playing, paused, unavailable, error.
    @Published private(set) var status = "loading"
    @Published private(set) var position = 0.0
    @Published private(set) var duration = 0.0

    private var player: AVPlayer?
    private var loadTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var timeObserver: Any?
    private var itemObservation: NSKeyValueObservation?
    private var controlObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var autoplay = false
    private var ready = false
    private var disposed = false
    /// Every teardown invalidates work already queued by lookup, KVO and seek callbacks.
    private var generation = UUID()
    private var startRequest = UUID()
    private var deadline = UUID()

    private let timeout: Duration
    private let lookup: (String, String) async -> Result<URL?, Error>
    private let makePlayer: (URL) -> AVPlayer
    private let sleep: (Duration) async throws -> Void

    // The defaults use the real providers. Injection keeps recovery tests independent of networking/audio.
    init(timeout: Duration = .seconds(12),
         lookup: @escaping (String, String) async -> Result<URL?, Error> = { id, storefront in
             await ApplePreviewPlayer.previewURL(id: id, storefront: storefront)
         },
         makePlayer: @escaping (URL) -> AVPlayer = { AVPlayer(playerItem: AVPlayerItem(url: $0)) },
         sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.timeout = timeout
        self.lookup = lookup
        self.makePlayer = makePlayer
        self.sleep = sleep
    }

    deinit {
        loadTask?.cancel()
        timeoutTask?.cancel()
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        itemObservation?.invalidate()
        controlObservation?.invalidate()
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        player?.pause()
    }

    /// Decodes only what is needed to find the preview file.
    private struct Lookup: Decodable {
        struct Result: Decodable {
            let wrapperType: String?
            let trackId: Int?
            let previewUrl: String?
        }
        let results: [Result]
    }

    func load(id: String, storefront: String, autoplay: Bool) {
        // A view may reappear after `dispose()`; loading again re-arms the player.
        dispose()
        disposed = false
        let generation = self.generation
        self.autoplay = autoplay
        #if os(iOS)
        // The default category follows the silent switch; the host expects to hear the preview.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        #endif
        ready = false
        position = 0
        duration = 0
        status = "loading"
        armDeadline()
        let lookup = self.lookup
        loadTask = Task { [weak self] in
            let outcome = await lookup(id, storefront)
            guard !Task.isCancelled, let self, self.isCurrent(generation) else { return }
            switch outcome {
            case .success(let url):
                if let url { self.attach(url, generation: generation) } else { self.finish("unavailable") }
            case .failure:
                self.finish("error")
            }
        }
    }

    func play() {
        guard !disposed, ready, let player else { return }
        if duration > 0, position >= duration - 0.5 {
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            position = 0
        }
        startRequest = UUID()
        status = "starting"
        armDeadline()
        player.play()
    }

    func pause() {
        guard !disposed, ready, let player else { return }
        startRequest = UUID()
        cancelDeadline()
        status = "paused"
        player.pause()
    }

    func restart() {
        guard !disposed, ready, let player else { return }
        position = 0
        startRequest = UUID()
        let request = startRequest
        let generation = self.generation
        status = "starting"
        armDeadline()
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] finished in
            Task { @MainActor in
                // Pause, dispose or a newer seek may have happened while this one ran.
                guard finished, let self, let player, self.isCurrent(generation), self.player === player,
                      self.startRequest == request, self.status == "starting" else { return }
                player.play()
            }
        }
    }

    func seek(to seconds: Double) {
        guard !disposed, ready, let player, seconds.isFinite else { return }
        let upper = duration > 0 ? duration : seconds
        let target = min(max(seconds, 0), max(upper, 0))
        startRequest = UUID()
        let request = startRequest
        let generation = self.generation
        let resumeAfterSeek = status == "starting"
        position = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] finished in
            Task { @MainActor in
                guard resumeAfterSeek, finished, let self, let player, self.isCurrent(generation), self.player === player,
                      self.startRequest == request, self.status == "starting" else { return }
                player.play()
            }
        }
    }

    func dispose() {
        disposed = true
        generation = UUID()
        startRequest = UUID()
        loadTask?.cancel()
        loadTask = nil
        cancelDeadline()
        teardownPlayer()
    }

    // MARK: Lookup

    nonisolated private static func previewURL(id: String, storefront: String) async -> Result<URL?, Error> {
        var components = URLComponents(string: "https://itunes.apple.com/lookup")
        components?.queryItems = [
            URLQueryItem(name: "id", value: id),
            URLQueryItem(name: "country", value: storefront),
            URLQueryItem(name: "entity", value: "song"),
        ]
        guard let url = components?.url else { return .failure(URLError(.badURL)) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return .failure(URLError(.badServerResponse))
            }
            let lookup = try JSONDecoder().decode(Lookup.self, from: data)
            guard let match = lookup.results.first(where: { $0.wrapperType == "track" && $0.trackId.map(String.init) == id }),
                  let text = match.previewUrl, let preview = URL(string: text),
                  preview.scheme == "https", let host = preview.host?.lowercased(),
                  host == "apple.com" || host.hasSuffix(".apple.com") else { return .success(nil) }
            return .success(preview)
        } catch {
            return .failure(error)
        }
    }

    // MARK: Playback

    private func attach(_ url: URL, generation: UUID) {
        guard isCurrent(generation) else { return }
        let player = makePlayer(url)
        guard let item = player.currentItem else { finish("error"); return }
        self.player = player

        itemObservation = item.observe(\.status, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                guard let self, self.isCurrent(generation), let currentItem = self.player?.currentItem else { return }
                self.itemStatusChanged(currentItem.status)
            }
        }
        controlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in
                guard let self, self.isCurrent(generation), let currentPlayer = self.player else { return }
                self.controlChanged(currentPlayer.timeControlStatus)
            }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor in
                guard let self, self.isCurrent(generation) else { return }
                self.timeChanged(seconds)
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isCurrent(generation) else { return }
                self.finished()
            }
        }
    }

    private func itemStatusChanged(_ itemStatus: AVPlayerItem.Status) {
        guard !disposed, player != nil else { return }
        switch itemStatus {
        case .readyToPlay:
            guard !ready else { return }
            ready = true
            cancelDeadline()
            updateDuration()
            status = "ready"
            if autoplay { play() }
        case .failed:
            finish("error")
        default:
            break
        }
    }

    private func controlChanged(_ control: AVPlayer.TimeControlStatus) {
        guard !disposed, ready else { return }
        switch control {
        case .playing:
            // A queued callback must not undo the host's explicit pause.
            guard status == "playing" || status == "starting" else { return }
            cancelDeadline()
            status = "playing"
        case .waitingToPlayAtSpecifiedRate:
            if status == "playing" || status == "starting" {
                status = "starting"
                armDeadline()
            }
        case .paused:
            // Ignore the brief paused state while a requested start or restart is in flight.
            if status == "playing" { cancelDeadline(); status = "paused" }
        @unknown default:
            break
        }
    }

    private func timeChanged(_ seconds: Double) {
        guard !disposed, player != nil else { return }
        updateDuration()
        if seconds.isFinite, seconds >= 0 { position = duration > 0 ? min(seconds, duration) : seconds }
        // A restart while already playing may not change timeControlStatus, so KVO stays silent.
        if status == "starting", player?.timeControlStatus == .playing {
            cancelDeadline()
            status = "playing"
        }
    }

    private func updateDuration() {
        guard let seconds = player?.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 else { return }
        duration = seconds
    }

    private func finished() {
        guard !disposed, player != nil else { return }
        cancelDeadline()
        if duration > 0 { position = duration }
        status = "paused"
    }

    private func isCurrent(_ generation: UUID) -> Bool { !disposed && self.generation == generation }

    private func armDeadline() {
        // Repeated buffering notifications cannot keep extending the same stall.
        guard timeoutTask == nil else { return }
        let generation = self.generation
        let deadline = UUID()
        self.deadline = deadline
        let timeout = self.timeout
        let sleep = self.sleep
        timeoutTask = Task { [weak self] in
            do { try await sleep(timeout) } catch { return }
            guard !Task.isCancelled, let self, self.isCurrent(generation), self.deadline == deadline else { return }
            self.finish("error")
        }
    }

    private func cancelDeadline() {
        deadline = UUID()
        timeoutTask?.cancel()
        timeoutTask = nil
    }

    private func finish(_ status: String) {
        // Terminal results stop audio and invalidate both queued observations and late lookup responses.
        dispose()
        self.status = status
    }

    private func teardownPlayer() {
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        itemObservation?.invalidate()
        itemObservation = nil
        controlObservation?.invalidate()
        controlObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player?.pause()
        player = nil
        ready = false
    }
}
