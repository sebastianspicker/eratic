import Foundation

enum AppConfig {
    /// Set after registering the app with Spotify (see README.md). `nil` disables Spotify.
    static let spotifyClientID: String? = nil
    /// Hosts of Eratic card URLs. Stays empty until a card domain is chosen.
    static let eraticCardHosts: [String] = []
}
