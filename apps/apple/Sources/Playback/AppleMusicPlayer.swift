import AVFoundation
import Foundation
import MusicKit

/// Full tracks through `ApplicationMusicPlayer` with a subscription, 30 s previews otherwise.
@MainActor
final class AppleMusicPlayer: Player {
    let provider = PlaybackProvider.appleMusic
    private(set) var tier = PlaybackTier.unavailable(reason: "Not connected")

    private var song: Song?
    private var previewPlayer: AVPlayer?
    private var usingPreview = false
    private let startTimeout = Duration.seconds(10)

    func connect(authorize: Bool) async throws {
        // MusicKit uses the system account and subscription, never an Eratic credential form.
        let status = MusicAuthorization.currentStatus == .notDetermined
            ? await MusicAuthorization.request() : MusicAuthorization.currentStatus
        guard status == .authorized else {
            tier = .unavailable(reason: PlaybackError.notAuthorised.localizedDescription)
            throw PlaybackError.notAuthorised
        }
        do {
            let subscription = try await MusicSubscription.current
            tier = subscription.canPlayCatalogContent ? .fullTrack : .previewOnly(maxMs: 30_000)
        } catch {
            let cause = Self.musicKitError(error)
            // Without MusicKit set up for this app, catalog previews fail too; say so now.
            if cause == .notConfigured {
                tier = .unavailable(reason: cause.localizedDescription)
                throw cause
            }
            tier = .previewOnly(maxMs: 30_000)
            Diagnostics.record("playback", "Apple Music subscription unknown, using 30-second previews: \(cause.localizedDescription)")
        }
    }

    /// MusicKit's failures in the player's terms: a build without the MusicKit app service fails
    /// its developer token, which is not a connection problem.
    static func musicKitError(_ error: Error) -> PlaybackError {
        if let token = error as? MusicTokenRequestError {
            switch token {
            case .developerTokenRequestFailed: return .notConfigured
            case .permissionDenied, .privacyAcknowledgementRequired, .userNotSignedIn, .userTokenRevoked: return .notAuthorised
            default: return .failed(token.localizedDescription)
            }
        }
        if let request = error as? MusicDataRequest.Error {
            return request.status == 404 ? .trackUnavailable : .failed(request.localizedDescription)
        }
        return PlaybackError.from(error)
    }

    func prepare(_ track: PlayableTrack) async throws {
        guard track.provider == .appleMusic else { throw PlaybackError.trackUnavailable }
        await stop()
        song = nil
        // The catalog request runs in the listener's storefront; a song missing there is unavailable.
        let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(track.id))
        let response: MusicCatalogResourceResponse<Song>
        do {
            response = try await request.response()
        } catch {
            throw Self.musicKitError(error)
        }
        guard let found = response.items.first else { throw PlaybackError.trackUnavailable }
        song = found
        if tier == .fullTrack {
            usingPreview = false
            let player = ApplicationMusicPlayer.shared
            player.queue = [found]
            try await player.prepareToPlay()
        } else {
            guard let url = found.previewAssets?.first?.url else { throw PlaybackError.trackUnavailable }
            usingPreview = true
            previewPlayer = AVPlayer(url: url)
        }
    }

    func play(fromMs: Int) async throws -> AudibleStart {
        guard song != nil else { throw PlaybackError.noTrackPrepared }
        let clock = ContinuousClock()
        let requestedAt = clock.now
        let target = Double(fromMs) / 1000
        if usingPreview {
            guard let player = previewPlayer else { throw PlaybackError.noTrackPrepared }
            await player.seek(to: CMTime(seconds: target, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
            player.play()
        } else {
            let player = ApplicationMusicPlayer.shared
            player.playbackTime = target
            do {
                try await player.play()
            } catch {
                throw MusicAuthorization.currentStatus == .authorized ? PlaybackError.playbackFailed : PlaybackError.notAuthorised
            }
        }
        let deadline = requestedAt.advanced(by: startTimeout)
        while clock.now < deadline {
            try Task.checkCancellation()
            if let position = currentPositionMs(), isPlaying, position > fromMs {
                // Audio began as many milliseconds ago as the position has advanced.
                let audibleAt = clock.now.advanced(by: .milliseconds(-min(position - fromMs, 1000)))
                return AudibleStart(requestedAt: requestedAt, audibleAt: max(requestedAt, audibleAt), positionMs: position)
            }
            try await clock.sleep(for: .milliseconds(20))
        }
        await stop()
        throw PlaybackError.timeout
    }

    func stop() async {
        previewPlayer?.pause()
        ApplicationMusicPlayer.shared.pause()
    }

    func positionMs() async -> Int? { currentPositionMs() }

    private var isPlaying: Bool {
        if usingPreview { return previewPlayer?.timeControlStatus == .playing }
        return ApplicationMusicPlayer.shared.state.playbackStatus == .playing
    }

    private func currentPositionMs() -> Int? {
        if usingPreview {
            guard let seconds = previewPlayer?.currentTime().seconds, seconds.isFinite else { return nil }
            return Int(seconds * 1000)
        }
        return Int(ApplicationMusicPlayer.shared.playbackTime * 1000)
    }
}
