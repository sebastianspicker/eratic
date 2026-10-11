import Foundation

enum AppConfig {
    /// Developer registration for optional timed playback. App links work without it.
    static let spotifyClientID: String? = nil
    /// Hosts of Eratic card URLs. Stays empty until a card domain is chosen.
    static let eraticCardHosts: [String] = []
}
