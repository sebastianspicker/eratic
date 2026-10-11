import Foundation

/// Controls a running Spotify app through the Web API (Premium only). Uses the cross-platform approach recorded in ADR 0011.
@MainActor
final class SpotifyConnectPlayer: Player {
    let provider = PlaybackProvider.spotify
    private(set) var tier = PlaybackTier.unavailable(reason: "Not connected")

    private struct Me: Decodable { let product: String? }
    private struct Devices: Decodable { let devices: [Device] }
    private struct Device: Decodable { let id: String?; let is_active: Bool }
    private struct PlayerState: Decodable {
        struct Item: Decodable { let uri: String? }
        let is_playing: Bool
        let progress_ms: Int?
        let item: Item?
    }

    private let auth: SpotifyAuth
    private var trackID: String?
    private var deviceID: String?
    private let api = "https://api.spotify.com/v1"
    private let startTimeout = Duration.seconds(10)

    init(auth: SpotifyAuth? = nil) {
        self.auth = auth ?? SpotifyAuth()
    }

    func connect(authorize: Bool) async throws {
        // Separate free/manual playback from controlled playback, inspired by HITSTER's
        // provider paths (ATTRIBUTION.md). App links work without API authorization.
        tier = .noExactPlayback
        guard AppConfig.spotifyClientID != nil else { return }
        guard auth.isSignedIn || authorize else { return }
        if authorize { _ = try await auth.accessToken(allowSignIn: true) }
        do {
            let (data, _) = try await send("GET", "/me")
            let me = try? JSONDecoder().decode(Me.self, from: data)
            tier = me?.product == "premium" ? .fullTrack : .noExactPlayback
        } catch PlaybackError.noSubscription {
            tier = .noExactPlayback
        }
    }

    func prepare(_ track: PlayableTrack) async throws {
        guard track.provider == .spotify else { throw PlaybackError.trackUnavailable }
        trackID = track.id
        let (data, _) = try await send("GET", "/me/player/devices")
        let devices = (try? JSONDecoder().decode(Devices.self, from: data))?.devices ?? []
        guard let device = devices.first(where: { $0.is_active && $0.id != nil }) ?? devices.first(where: { $0.id != nil }) else {
            throw PlaybackError.noActiveDevice
        }
        deviceID = device.id
    }

    func play(fromMs: Int) async throws -> AudibleStart {
        guard let trackID, let deviceID else { throw PlaybackError.noTrackPrepared }
        guard tier == .fullTrack else { throw PlaybackError.noSubscription }
        let uri = "spotify:track:\(trackID)"
        let clock = ContinuousClock()
        let requestedAt = clock.now
        let body = try JSONSerialization.data(withJSONObject: ["uris": [uri], "position_ms": fromMs])
        var unreserved = CharacterSet.alphanumerics
        unreserved.insert(charactersIn: "-._~")
        guard let encodedDevice = deviceID.addingPercentEncoding(withAllowedCharacters: unreserved) else { throw PlaybackError.noActiveDevice }
        _ = try await send("PUT", "/me/player/play?device_id=\(encodedDevice)", body: body)
        let deadline = requestedAt.advanced(by: startTimeout)
        while clock.now < deadline {
            try Task.checkCancellation()
            try await clock.sleep(for: .milliseconds(150))
            let (data, _) = try await send("GET", "/me/player")
            if let state = try? JSONDecoder().decode(PlayerState.self, from: data),
               state.is_playing, state.item?.uri == uri, let progress = state.progress_ms, progress > fromMs {
                let now = clock.now
                return AudibleStart(requestedAt: requestedAt,
                                    audibleAt: now.advanced(by: .milliseconds(-(progress - fromMs))),
                                    positionMs: progress)
            }
        }
        await stop()
        throw PlaybackError.timeout
    }

    func stop() async {
        _ = try? await send("PUT", "/me/player/pause")
    }

    func positionMs() async -> Int? {
        guard let (data, _) = try? await send("GET", "/me/player") else { return nil }
        return (try? JSONDecoder().decode(PlayerState.self, from: data))?.progress_ms
    }

    /// One request with a single refresh on 401 and a single `Retry-After` wait on 429.
    private func send(_ method: String, _ path: String, body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var refreshed = false
        var retried = false
        while true {
            guard let url = URL(string: api + path) else { throw PlaybackError.network }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
            if let body {
                request.httpBody = body
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            let data: Data, response: URLResponse
            do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw PlaybackError.network }
            guard let http = response as? HTTPURLResponse else { throw PlaybackError.network }
            switch http.statusCode {
            case 200..<300:
                return (data, http)
            case 401:
                guard !refreshed else { throw PlaybackError.notAuthorised }
                refreshed = true
                _ = try await auth.refresh()
            case 429:
                guard !retried else { throw PlaybackError.network }
                retried = true
                let seconds = Double(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 1
                try await Task.sleep(for: .seconds(min(max(seconds, 0), 10)))
            case 403:
                throw PlaybackError.noSubscription
            case 404:
                throw PlaybackError.noActiveDevice
            default:
                throw PlaybackError.network
            }
        }
    }
}
