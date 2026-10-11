import EraticCore
import Foundation

/// Session-scope owner of the chosen provider and its adapter.
@MainActor
final class PlaybackHub: ObservableObject {
    enum Status: Equatable {
        case idle
        case connecting
        case connected
        case failed
    }

    @Published private(set) var provider: PlaybackProvider
    @Published private(set) var tier = PlaybackTier.unavailable(reason: "Not connected")
    @Published private(set) var status = Status.idle
    @Published private(set) var error: PlaybackError?

    private let openURL: (URL) -> Void
    private var players: [PlaybackProvider: Player] = [:]

    /// `openURL` serves the manual adapter; pass SwiftUI's `OpenURLAction`.
    init(provider: PlaybackProvider = .manual, openURL: @escaping (URL) -> Void) {
        self.provider = provider
        self.openURL = openURL
    }

    /// The adapter for the chosen provider, created on first use.
    var player: Player { adapter(provider) }

    func connect(_ provider: PlaybackProvider, authorize: Bool = false) async {
        guard status != .connecting else { return }
        // Until the new adapter is connected, nothing may target it with exact clips.
        tier = .noExactPlayback
        self.provider = provider
        status = .connecting
        error = nil
        let adapter = adapter(provider)
        do {
            try await adapter.connect(authorize: authorize)
            tier = adapter.tier
            status = .connected
        } catch {
            self.error = error as? PlaybackError ?? .network
            status = .failed
        }
    }

    func track(for card: SongCard) -> PlayableTrack? {
        PlayableTrack.from(card: card, provider: provider)
    }

    private func adapter(_ provider: PlaybackProvider) -> Player {
        if let existing = players[provider] { return existing }
        let created: Player
        switch provider {
        case .appleMusic: created = AppleMusicPlayer()
        case .spotify: created = SpotifyConnectPlayer()
        case .manual: created = ManualPlayer(openURL: openURL)
        }
        players[provider] = created
        return created
    }
}
