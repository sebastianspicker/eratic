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

    private let loadTimeout = Duration.seconds(12)

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
        disposed = false
        teardownPlayer()
        loadTask?.cancel()
        timeoutTask?.cancel()
        self.autoplay = autoplay
        #if os(iOS)
        // The default category follows the silent switch; the host expects to hear the preview.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        #endif
        ready = false
        position = 0
        duration = 0
        status = "loading"
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: self?.loadTimeout ?? .seconds(12))
            guard !Task.isCancelled, let self, !self.disposed, !self.ready, self.status == "loading" else { return }
            self.teardownPlayer()
            self.status = "error"
        }
        loadTask = Task { [weak self] in
            let outcome = await Self.previewURL(id: id, storefront: storefront)
            guard !Task.isCancelled, let self, !self.disposed else { return }
            switch outcome {
            case .success(let url):
                if let url { self.attach(url) } else { self.timeoutTask?.cancel(); self.status = "unavailable" }
            case .failure:
                self.timeoutTask?.cancel()
                self.status = "error"
            }
        }
    }

    func play() {
        guard !disposed, ready, let player else { return }
        if duration > 0, position >= duration - 0.5 {
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            position = 0
        }
        status = "starting"
        player.play()
    }

    func pause() {
        guard !disposed, ready, let player else { return }
        player.pause()
        status = "paused"
    }

    func restart() {
        guard !disposed, ready, let player else { return }
        position = 0
        status = "starting"
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] finished in
            Task { @MainActor in
                // Pause, dispose or a newer seek may have happened while this one ran.
                guard finished, let self, let player, !self.disposed, self.player === player,
                      self.status == "starting" else { return }
                player.play()
            }
        }
    }

    func seek(to seconds: Double) {
        guard !disposed, ready, let player, seconds.isFinite else { return }
        let upper = duration > 0 ? duration : seconds
        let target = min(max(seconds, 0), max(upper, 0))
        position = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func dispose() {
        disposed = true
        loadTask?.cancel()
        timeoutTask?.cancel()
        loadTask = nil
        timeoutTask = nil
        teardownPlayer()
    }

    // MARK: Lookup

    private static func previewURL(id: String, storefront: String) async -> Result<URL?, Error> {
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

    private func attach(_ url: URL) {
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player

        itemObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let itemStatus = item.status
            Task { @MainActor in self?.itemStatusChanged(itemStatus) }
        }
        controlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let control = player.timeControlStatus
            Task { @MainActor in self?.controlChanged(control) }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor in self?.timeChanged(seconds) }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.finished() }
        }
    }

    private func itemStatusChanged(_ itemStatus: AVPlayerItem.Status) {
        guard !disposed, player != nil else { return }
        switch itemStatus {
        case .readyToPlay:
            guard !ready else { return }
            ready = true
            timeoutTask?.cancel()
            updateDuration()
            status = "ready"
            if autoplay { play() }
        case .failed:
            timeoutTask?.cancel()
            player?.pause()
            ready = false
            status = "error"
        default:
            break
        }
    }

    private func controlChanged(_ control: AVPlayer.TimeControlStatus) {
        guard !disposed, ready else { return }
        switch control {
        case .playing:
            status = "playing"
        case .waitingToPlayAtSpecifiedRate:
            if status == "playing" || status == "starting" { status = "starting" }
        case .paused:
            // Ignore the brief paused state while a requested start or restart is in flight.
            if status == "playing" { status = "paused" }
        @unknown default:
            break
        }
    }

    private func timeChanged(_ seconds: Double) {
        guard !disposed, player != nil else { return }
        updateDuration()
        if seconds.isFinite, seconds >= 0 { position = duration > 0 ? min(seconds, duration) : seconds }
        // A restart while already playing may not change timeControlStatus, so KVO stays silent.
        if status == "starting", player?.timeControlStatus == .playing { status = "playing" }
    }

    private func updateDuration() {
        guard let seconds = player?.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 else { return }
        duration = seconds
    }

    private func finished() {
        guard !disposed, player != nil else { return }
        if duration > 0 { position = duration }
        status = "paused"
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
