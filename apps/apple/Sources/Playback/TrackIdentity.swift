import EraticCore
import Foundation

// App-local parsing; a shared core version will replace this file.
extension PlayableTrack {
    /// The card's first link for `provider`, reduced to a provider track ID.
    static func from(card: SongCard, provider: PlaybackProvider) -> PlayableTrack? {
        switch provider {
        case .spotify:
            guard let link = card.links.first(where: { $0.provider == .spotify }),
                  let id = spotifyID(link) else { return nil }
            return PlayableTrack(provider: .spotify, id: id, storefront: nil, url: URL(string: link.url))
        case .appleMusic:
            guard let link = card.links.first(where: { $0.provider == .appleMusic }),
                  let (id, storefront) = appleMusicID(link) else { return nil }
            return PlayableTrack(provider: .appleMusic, id: id, storefront: storefront, url: URL(string: link.url))
        case .manual:
            guard let link = card.links.first, let url = URL(string: link.url) else { return nil }
            return PlayableTrack(provider: .manual, id: link.id ?? card.id, storefront: nil, url: url)
        }
    }

    private static func spotifyID(_ link: ProviderLink) -> String? {
        if let id = link.id, isSpotifyID(id) { return id }
        guard let url = URLComponents(string: link.url), url.host == "open.spotify.com" else { return nil }
        var parts = url.path.split(separator: "/").map(String.init)
        if let first = parts.first, first.hasPrefix("intl-") { parts.removeFirst() }
        guard parts.count >= 2, parts[0] == "track", isSpotifyID(parts[1]) else { return nil }
        return parts[1]
    }

    private static func isSpotifyID(_ s: String) -> Bool {
        s.count == 22 && s.unicodeScalars.allSatisfy { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0)) }
    }

    private static func appleMusicID(_ link: ProviderLink) -> (String, String?)? {
        let components = URLComponents(string: link.url)
        let parts = components?.path.split(separator: "/").map(String.init) ?? []
        var storefront: String?
        if let first = parts.first, first.count == 2, first.unicodeScalars.allSatisfy({ $0.isASCII && $0.properties.isAlphabetic }) {
            storefront = first.lowercased()
        }
        if let id = link.id, isDigits(id) { return (id, storefront) }
        guard components?.host == "music.apple.com" else { return nil }
        if let i = components?.queryItems?.first(where: { $0.name == "i" })?.value, isDigits(i) {
            return (i, storefront)
        }
        if let idx = parts.firstIndex(of: "song"), let last = parts.last, idx < parts.count - 1, isDigits(last) {
            return (last, storefront)
        }
        return nil
    }

    private static func isDigits(_ s: String) -> Bool {
        !s.isEmpty && s.unicodeScalars.allSatisfy { ("0"..."9").contains($0) }
    }
}
