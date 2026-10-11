import Foundation

/// A provider's identity for one track (game-rules.md section 8.1).
public struct ProviderTrack: Equatable, Sendable {
    public var provider: Provider
    public var id: String
    /// Apple Music only, lowercased.
    public var storefront: String?

    public init(provider: Provider, id: String, storefront: String? = nil) {
        self.provider = provider
        self.id = id
        self.storefront = storefront
    }

    /// `{provider, id, storefront?}`
    public var jsonObject: [String: Any] {
        var object: [String: Any] = ["provider": provider.rawValue, "id": id]
        if let storefront { object["storefront"] = storefront }
        return object
    }
}

public enum ScanVia: String, Sendable {
    case eraticCard, providerLink, officialCard
}

/// What a scanned QR payload selects in a deck (section 8.2).
public enum ScanResult: Equatable, Sendable {
    case card(cardId: String, via: ScanVia)
    case unknownCard(cardId: String)
    case otherDeck(deckId: String)
    case unmatchedProvider(provider: Provider, trackId: String)
    case unmatchedOfficial
    case unrecognized

    /// The contract's JSON shape, e.g. `{kind: "card", cardId, via}`.
    public var jsonObject: [String: Any] {
        switch self {
        case let .card(cardId, via): return ["kind": "card", "cardId": cardId, "via": via.rawValue]
        case let .unknownCard(cardId): return ["kind": "unknownCard", "cardId": cardId]
        case let .otherDeck(deckId): return ["kind": "otherDeck", "deckId": deckId]
        case let .unmatchedProvider(provider, trackId): return ["kind": "unmatchedProvider", "provider": provider.rawValue, "trackId": trackId]
        case .unmatchedOfficial: return ["kind": "unmatchedOfficial"]
        case .unrecognized: return ["kind": "unrecognized"]
        }
    }
}

/// Provider track parsing, the Eratic card URL and scan resolution, written over Unicode
/// scalars like `CardURLPolicy`, without `URL` or `URLComponents`.
public enum ScanRules {
    /// A safe HTTPS URL split at its authority, path, query and fragment.
    struct Parts {
        let authority: [Unicode.Scalar]
        let path: [Unicode.Scalar]
        let query: [Unicode.Scalar]?
        let fragment: [Unicode.Scalar]?

        init?(_ text: String) {
            guard CardURLPolicy.isSafeHTTPS(text) else { return nil }
            let scalars = Array(text.unicodeScalars.dropFirst(8))
            authority = Array(scalars.prefix { $0 != "/" && $0 != "?" && $0 != "#" })
            var rest = scalars.dropFirst(authority.count)
            let pathPart = rest.prefix { $0 != "?" && $0 != "#" }
            path = Array(pathPart)
            rest = rest.dropFirst(pathPart.count)
            if rest.first == "?" {
                let queryPart = rest.dropFirst().prefix { $0 != "#" }
                query = Array(queryPart)
                rest = rest.dropFirst(1 + queryPart.count)
            } else {
                query = nil
            }
            fragment = rest.first == "#" ? Array(rest.dropFirst()) : nil
        }

        /// The authority without a port, ASCII-lowercased.
        var host: String { asciiLowercased(string(authority.prefix { $0 != ":" })) }

        /// Path segments after the leading `/`; `nil` when the path is empty.
        var segments: [String]? {
            guard path.first == "/" else { return nil }
            return path.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map(string)
        }
    }

    static func string<S: Sequence>(_ scalars: S) -> String where S.Element == Unicode.Scalar {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }

    /// Lowercases A–Z only: no Unicode case mapping, so hosts compare exactly (game-rules.md section 1.1).
    static func asciiLowercased(_ text: String) -> String {
        string(text.unicodeScalars.map { ("A"..."Z").contains($0) ? Unicode.Scalar($0.value + 32)! : $0 })
    }

    static func isASCII(_ text: String, count: ClosedRange<Int>, _ allowed: (Unicode.Scalar) -> Bool) -> Bool {
        count.contains(text.unicodeScalars.count) && text.unicodeScalars.allSatisfy { $0.isASCII && allowed($0) }
    }

    static func isDigit(_ scalar: Unicode.Scalar) -> Bool { ("0"..."9").contains(scalar) }
    static func isLetter(_ scalar: Unicode.Scalar) -> Bool { ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) }

    static func isSpotifyID(_ text: String) -> Bool { isASCII(text, count: 22...22) { isDigit($0) || isLetter($0) } }
    static func isAppleMusicID(_ text: String) -> Bool { isASCII(text, count: 1...15, isDigit) }

    /// `{provider, id}` for a Spotify or Apple Music track URL (or `spotify:track:` URI), otherwise `nil`.
    public static func providerTrack(_ text: String) -> ProviderTrack? {
        let uri = "spotify:track:".unicodeScalars
        if text.unicodeScalars.starts(with: uri) {
            let id = string(text.unicodeScalars.dropFirst(uri.count))
            return isSpotifyID(id) ? ProviderTrack(provider: .spotify, id: id) : nil
        }
        guard let parts = Parts(text), let segments = parts.segments else { return nil }
        let host = parts.host
        if same(host, "open.spotify.com") {
            var rest = segments[...]
            if let first = rest.first, first.unicodeScalars.starts(with: "intl-".unicodeScalars) {
                guard isASCII(string(first.unicodeScalars.dropFirst(5)), count: 1...Int.max, { isLetter($0) || $0 == "-" }) else { return nil }
                rest = rest.dropFirst()
            }
            guard rest.count == 2, let first = rest.first, same(first, "track"), let id = rest.last, isSpotifyID(id) else { return nil }
            return ProviderTrack(provider: .spotify, id: id)
        }
        guard same(host, "music.apple.com") else { return nil }
        guard segments.count >= 3, isASCII(segments[0], count: 2...2, isLetter) else { return nil }
        let storefront = segments[0].lowercased()
        let song: String
        switch (segments[1], segments.count) {
        case ("album", 4):
            guard !segments[2].isEmpty, !segments[3].isEmpty, let query = parts.query else { return nil }
            let parameters = query.split(separator: "&", omittingEmptySubsequences: false)
            guard let parameter = parameters.first(where: { $0.prefix { $0 != "=" }.elementsEqual("i".unicodeScalars) }),
                  parameter.contains("=") else { return nil }
            song = string(parameter.drop { $0 != "=" }.dropFirst())
        case ("song", 3):
            song = segments[2]
        case ("song", 4):
            guard !segments[2].isEmpty else { return nil }
            song = segments[3]
        default:
            return nil
        }
        return isAppleMusicID(song) ? ProviderTrack(provider: .appleMusic, id: song, storefront: storefront) : nil
    }

    /// The link's own ID when it has the provider's shape, else its URL's track if that is the same provider.
    public static func linkTrack(_ link: ProviderLink) -> ProviderTrack? {
        switch link.provider {
        case .spotify:
            if let id = link.id, isSpotifyID(id) { return ProviderTrack(provider: .spotify, id: id) }
        case .appleMusic:
            if let id = link.id, isAppleMusicID(id) { return ProviderTrack(provider: .appleMusic, id: id) }
        case .youtube, .other:
            return nil
        }
        guard let track = providerTrack(link.url), track.provider == link.provider else { return nil }
        return track
    }

    /// A configured host is valid when `https://<host>/` is a safe HTTPS URL and it has none of `:`, `/`, `?`, `#`.
    public static func isValidEraticHost(_ host: String) -> Bool {
        !host.unicodeScalars.contains(where: { $0 == ":" || $0 == "/" || $0 == "?" || $0 == "#" })
            && CardURLPolicy.isSafeHTTPS("https://" + host + "/")
    }

    /// `https://<host>/c/<deckId>/<cardId>`, or `nil` for an invalid host or ID.
    public static func eraticCardURL(host: String, deckId: String, cardId: String) -> String? {
        guard isValidEraticHost(host), DeckCodec.isIdentifier(deckId), DeckCodec.isIdentifier(cardId) else { return nil }
        return "https://\(host)/c/\(deckId)/\(cardId)"
    }

    static func same(_ first: String, _ second: String) -> Bool { first.utf8.elementsEqual(second.utf8) }

    /// The first rule of section 8.2 that applies. A scan only selects a card; it never opens anything.
    public static func resolveScan(payload: String, deck: Deck, hosts: [String]) -> ScanResult {
        if let parts = Parts(payload), parts.query == nil, parts.fragment == nil,
           // The host is the authority without its port, which a safe URL allows only empty or 443.
           hosts.contains(where: { same(asciiLowercased($0), parts.host) }),
           let segments = parts.segments, segments.count == 3, same(segments[0], "c"),
           DeckCodec.isIdentifier(segments[1]), DeckCodec.isIdentifier(segments[2]) {
            let (deckId, cardId) = (segments[1], segments[2])
            guard same(deckId, deck.id) else { return .otherDeck(deckId: deckId) }
            return deck.cards.contains(where: { same($0.id, cardId) }) ? .card(cardId: cardId, via: .eraticCard) : .unknownCard(cardId: cardId)
        }
        if let card = deck.cards.first(where: { $0.links.contains { same($0.url, payload) } }) {
            return .card(cardId: card.id, via: .providerLink)
        }
        if let track = providerTrack(payload) {
            let match = deck.cards.first { card in
                card.links.contains { link in linkTrack(link).map { $0.provider == track.provider && same($0.id, track.id) } ?? false }
            }
            if let match { return .card(cardId: match.id, via: .providerLink) }
            return .unmatchedProvider(provider: track.provider, trackId: track.id)
        }
        if let card = deck.cards.first(where: { $0.officialCard.map { same($0.url, payload) } ?? false }) {
            return .card(cardId: card.id, via: .officialCard)
        }
        return CardURLPolicy.isOfficialCardURL(payload) ? .unmatchedOfficial : .unrecognized
    }
}
