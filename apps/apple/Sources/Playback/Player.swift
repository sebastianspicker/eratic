import Foundation

enum PlaybackProvider: String, CaseIterable, Identifiable {
    case appleMusic, spotify, manual

    var id: String { rawValue }

    var label: String {
        switch self {
        case .appleMusic: return "Apple Music"
        case .spotify: return "Spotify"
        case .manual: return "Play it yourself"
        }
    }
}

enum PlaybackTier: Equatable {
    case fullTrack
    case previewOnly(maxMs: Int)
    case noExactPlayback
    case unavailable(reason: String)

    /// Exact clip timing is possible for full tracks and previews.
    var exactClips: Bool {
        switch self {
        case .fullTrack, .previewOnly: return true
        case .noExactPlayback, .unavailable: return false
        }
    }
}

struct PlayableTrack: Equatable {
    let provider: PlaybackProvider
    let id: String
    let storefront: String?
    let url: URL?
}

/// Timestamps of one start request. `audibleAt` is when sound was actually audible.
struct AudibleStart {
    let requestedAt: ContinuousClock.Instant
    let audibleAt: ContinuousClock.Instant
    let positionMs: Int
}

enum PlaybackError: LocalizedError, Equatable {
    case notAuthorised
    case noSubscription
    case trackUnavailable
    case noActiveDevice
    case network
    case timeout
    case notConfigured
    case noTrackPrepared
    case playbackFailed

    var errorDescription: String? {
        switch self {
        case .notAuthorised: return "Eratic is not authorised to play music. Check the permission and sign in again."
        case .noSubscription: return "This needs an active subscription."
        case .trackUnavailable: return "This song is not available in your storefront."
        case .noActiveDevice: return "No active Spotify device. Open Spotify on this device first."
        case .network: return "The music service could not be reached. Check your connection."
        case .timeout: return "Playback did not start in time."
        case .notConfigured: return "This music service is not set up in this build."
        case .noTrackPrepared: return "No song is prepared for playback."
        case .playbackFailed: return "Apple Music couldn't start this song."
        }
    }
}

@MainActor
protocol Player: AnyObject {
    var provider: PlaybackProvider { get }
    /// Detected by `connect()`.
    var tier: PlaybackTier { get }
    /// Reuse existing authorization; interactive Spotify sign-in is opt-in.
    func connect(authorize: Bool) async throws
    func prepare(_ track: PlayableTrack) async throws
    /// Returns once audio is actually audible.
    func play(fromMs: Int) async throws -> AudibleStart
    func stop() async
    func positionMs() async -> Int?
}
