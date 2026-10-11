import Foundation

/// "Play it yourself": opens the song's link and cannot time clips.
@MainActor
final class ManualPlayer: Player {
    let provider = PlaybackProvider.manual
    private(set) var tier = PlaybackTier.noExactPlayback
    private let openURL: (URL) -> Void
    private var url: URL?

    /// Pass SwiftUI's `OpenURLAction` as `{ openURL($0) }`.
    init(openURL: @escaping (URL) -> Void) {
        self.openURL = openURL
    }

    func connect(authorize: Bool) async throws {}

    func prepare(_ track: PlayableTrack) async throws {
        url = track.url
    }

    func play(fromMs: Int) async throws -> AudibleStart {
        guard let url else { throw PlaybackError.noTrackPrepared }
        let now = ContinuousClock.now
        openURL(url)
        return AudibleStart(requestedAt: now, audibleAt: now, positionMs: fromMs)
    }

    func stop() async {}

    func positionMs() async -> Int? { nil }
}
