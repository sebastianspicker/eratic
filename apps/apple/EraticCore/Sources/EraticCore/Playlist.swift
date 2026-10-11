import Foundation

// Playlist review candidates: contract/playlist-candidates.md. A candidate is what a provider said
// about one entry; it never becomes a card without a curated year and source (ADR 0004). Fetching
// belongs to provider adapters beside each core.

/// A parsed JSON value that keeps booleans distinct from numbers (`is_playable: 0` is not `false`).
public enum ProviderJSON: Decodable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([ProviderJSON])
    case object([String: ProviderJSON])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([ProviderJSON].self) { self = .array(value) }
        else { self = .object(try container.decode([String: ProviderJSON].self)) }
    }

    var objectValue: [String: ProviderJSON]? { if case let .object(value) = self { return value } else { return nil } }
    var arrayValue: [ProviderJSON]? { if case let .array(value) = self { return value } else { return nil } }
    var stringValue: String? { if case let .string(value) = self { return value } else { return nil } }
}

public enum CandidateProvider: String, Codable, Sendable {
    case spotify, appleMusic
}

public enum CandidateKind: String, Codable, Sendable {
    case track, local, unsupported, missing, malformed
}

/// `{provider, id}` of a playlist, plus the lowercased `storefront` for Apple Music (section 1).
public struct PlaylistReference: Equatable, Sendable {
    public var provider: CandidateProvider
    public var id: String
    public var storefront: String?

    public init(provider: CandidateProvider, id: String, storefront: String? = nil) {
        self.provider = provider
        self.id = id
        self.storefront = storefront
    }
}

/// What a provider said about one playlist entry (section 2); absent members are not encoded.
public struct Candidate: Codable, Equatable, Sendable {
    public var position: Int
    public var provider: CandidateProvider
    public var kind: CandidateKind
    public var available: Bool?
    public var id: String?
    public var url: String?
    public var title: String?
    public var artist: String?
    public var album: String?
    public var releaseDate: String?
    public var isrc: String?

    public init(position: Int, provider: CandidateProvider, kind: CandidateKind, available: Bool? = nil, id: String? = nil, url: String? = nil,
                title: String? = nil, artist: String? = nil, album: String? = nil, releaseDate: String? = nil, isrc: String? = nil) {
        self.position = position
        self.provider = provider
        self.kind = kind
        self.available = available
        self.id = id
        self.url = url
        self.title = title
        self.artist = artist
        self.album = album
        self.releaseDate = releaseDate
        self.isrc = isrc
    }
}

/// One review entry per candidate (section 4). `issues` are `unavailable`, `duplicate`, `sameIsrc`,
/// `inDeck`, `sameIsrcInDeck`, `noYear`, or the candidate's kind when it is not a `track`.
public struct ReviewEntry: Codable, Equatable, Sendable {
    public var position: Int
    public var issues: [String]
    public var duplicateOf: Int?
    public var sameIsrcAs: Int?
    public var cardId: String?
    public var isrcCardId: String?
    public var proposedYear: Int?

    public init(position: Int, issues: [String] = [], duplicateOf: Int? = nil, sameIsrcAs: Int? = nil, cardId: String? = nil, isrcCardId: String? = nil, proposedYear: Int? = nil) {
        self.position = position
        self.issues = issues
        self.duplicateOf = duplicateOf
        self.sameIsrcAs = sameIsrcAs
        self.cardId = cardId
        self.isrcCardId = isrcCardId
        self.proposedYear = proposedYear
    }
}

/// The curated year and optional title and artist overrides for a promotion (section 5).
public struct PromotionDecision: Equatable, Sendable {
    public var gameYear: GameYear
    public var title: String?
    public var artist: String?

    public init(gameYear: GameYear, title: String? = nil, artist: String? = nil) {
        self.gameYear = gameYear
        self.title = title
        self.artist = artist
    }
}

public enum PromotionError: String, Error, Sendable {
    case notTrack, inDeck, invalid
}

public enum PlaylistRules {
    // MARK: Text rules

    /// Visible text is the schema's `\S` (contract/README.md); text is never trimmed or truncated.
    private static func isVisible(_ value: String) -> Bool {
        DeckCodec.isVisibleText(value, maximum: Int.max)
    }

    private static func visible(_ value: ProviderJSON?) -> String? {
        guard let text = value?.stringValue, isVisible(text) else { return nil }
        return text
    }

    private static func isASCIIUpper(_ scalar: Unicode.Scalar) -> Bool { ("A"..."Z").contains(scalar) }

    /// `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, ASCII digits, not range-checked.
    private static func isReleaseDate(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        guard [4, 7, 10].contains(scalars.count) else { return false }
        for (index, scalar) in scalars.enumerated() {
            let isDash = index == 4 || index == 7
            if isDash ? scalar != "-" : !ScanRules.isDigit(scalar) { return false }
        }
        return true
    }

    /// `[A-Z]{2}[A-Z0-9]{3}[0-9]{7}`, the deck ISRC pattern.
    private static func isISRC(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        guard scalars.count == 12 else { return false }
        return scalars.enumerated().allSatisfy { index, scalar in
            switch index {
            case 0, 1: return isASCIIUpper(scalar)
            case 2, 3, 4: return isASCIIUpper(scalar) || ScanRules.isDigit(scalar)
            default: return ScanRules.isDigit(scalar)
            }
        }
    }

    /// Every `-` removed, ASCII letters uppercased, kept only if it matches the deck ISRC pattern.
    private static func normalizedISRC(_ text: String) -> String? {
        let normal = ScanRules.string(text.unicodeScalars.filter { $0 != "-" }.map { ("a"..."z").contains($0) ? Unicode.Scalar($0.value - 32)! : $0 })
        return isISRC(normal) ? normal : nil
    }

    private static func isStorefront(_ text: String) -> Bool { ScanRules.isASCII(text, count: 2...2, ScanRules.isLetter) }

    private static let maximumStart = 1_000_000_000

    private static func hasPrefix(_ text: String, _ prefix: String) -> Bool { text.unicodeScalars.starts(with: prefix.unicodeScalars) }

    // MARK: Section 1

    /// The playlist a pasted link or URI names, or `nil`.
    public static func playlistReference(_ text: String) -> PlaylistReference? {
        let uri = "spotify:playlist:"
        if hasPrefix(text, uri) {
            let id = ScanRules.string(text.unicodeScalars.dropFirst(uri.unicodeScalars.count))
            return ScanRules.isSpotifyID(id) ? PlaylistReference(provider: .spotify, id: id) : nil
        }
        guard let parts = ScanRules.Parts(text), let segments = parts.segments else { return nil }
        let host = parts.host
        if ScanRules.same(host, "open.spotify.com") {
            var rest = segments[...]
            if let first = rest.first, hasPrefix(first, "intl-") {
                guard ScanRules.isASCII(ScanRules.string(first.unicodeScalars.dropFirst(5)), count: 1...Int.max, { ScanRules.isLetter($0) || $0 == "-" }) else { return nil }
                rest = rest.dropFirst()
            }
            guard rest.count == 2, let kind = rest.first, ScanRules.same(kind, "playlist"), let id = rest.last, ScanRules.isSpotifyID(id) else { return nil }
            return PlaylistReference(provider: .spotify, id: id)
        }
        guard ScanRules.same(host, "music.apple.com"), segments.count == 3 || segments.count == 4,
              isStorefront(segments[0]), ScanRules.same(segments[1], "playlist") else { return nil }
        if segments.count == 4, segments[2].isEmpty { return nil }
        let id = segments[segments.count - 1]
        guard isApplePlaylistID(id) else { return nil }
        return PlaylistReference(provider: .appleMusic, id: id, storefront: ScanRules.asciiLowercased(segments[0]))
    }

    /// `pl.` followed by 1–100 of `[0-9A-Za-z_-]`, the first a letter or digit.
    private static func isApplePlaylistID(_ text: String) -> Bool {
        guard hasPrefix(text, "pl.") else { return false }
        let tail = Array(text.unicodeScalars.dropFirst(3))
        guard (1...100).contains(tail.count), tail.allSatisfy({ $0.isASCII && (ScanRules.isDigit($0) || ScanRules.isLetter($0) || $0 == "_" || $0 == "-") }) else { return false }
        return ScanRules.isDigit(tail[0]) || ScanRules.isLetter(tail[0])
    }

    // MARK: Section 2

    /// `album`, `releaseDate` and `isrc` members, emitted only when present and well formed.
    private static func applyOptional(to candidate: inout Candidate, album: ProviderJSON?, releaseDate: ProviderJSON?, isrc: ProviderJSON?) {
        candidate.album = visible(album)
        if let date = releaseDate?.stringValue, isReleaseDate(date) { candidate.releaseDate = date }
        if let raw = isrc?.stringValue { candidate.isrc = normalizedISRC(raw) }
    }

    // MARK: Section 3.1

    private static func spotifyCandidate(_ item: ProviderJSON, position: Int) -> Candidate {
        func bare(_ kind: CandidateKind) -> Candidate { Candidate(position: position, provider: .spotify, kind: kind) }
        guard let item = item.objectValue else { return bare(.malformed) }
        guard let t = item["item"]?.objectValue ?? item["track"]?.objectValue else { return bare(.missing) }
        let album = t["album"]?.objectValue ?? [:]
        let external = t["external_ids"]?.objectValue ?? [:]
        let artist = (t["artists"]?.arrayValue ?? []).compactMap { visible($0.objectValue?["name"]) }.joined(separator: ", ")
        if item["is_local"] == .bool(true) {
            var local = bare(.local)
            local.title = visible(t["name"])
            local.artist = isVisible(artist) ? artist : nil
            applyOptional(to: &local, album: album["name"], releaseDate: album["release_date"], isrc: external["isrc"])
            return local
        }
        guard t["type"] == .string("track") else { return bare(.unsupported) }
        guard let id = t["id"]?.stringValue, ScanRules.isSpotifyID(id), let title = visible(t["name"]), !artist.isEmpty else { return bare(.malformed) }
        var track = bare(.track)
        track.available = t["is_playable"] != .bool(false)
        track.id = id
        track.url = "https://open.spotify.com/track/\(id)"
        track.title = title
        track.artist = artist
        applyOptional(to: &track, album: album["name"], releaseDate: album["release_date"], isrc: external["isrc"])
        return track
    }

    // MARK: Section 3.2

    private static func appleCandidate(_ resource: ProviderJSON, position: Int, storefront: String) -> Candidate {
        func bare(_ kind: CandidateKind) -> Candidate { Candidate(position: position, provider: .appleMusic, kind: kind) }
        guard let resource = resource.objectValue, let type = resource["type"]?.stringValue else { return bare(.malformed) }
        guard ScanRules.same(type, "songs") || ScanRules.same(type, "library-songs") else { return bare(.unsupported) }
        guard let a = resource["attributes"]?.objectValue, let name = visible(a["name"]), let artistName = visible(a["artistName"]) else { return bare(.malformed) }
        var common = bare(.local)
        common.title = name
        common.artist = artistName
        applyOptional(to: &common, album: a["albumName"], releaseDate: a["releaseDate"], isrc: a["isrc"])
        var id: String?
        var available = true
        let playParams = a["playParams"]?.objectValue
        if ScanRules.same(type, "songs") {
            guard let songID = resource["id"]?.stringValue, ScanRules.isAppleMusicID(songID) else { return bare(.malformed) }
            id = songID
            available = playParams != nil
        } else if let catalogID = playParams?["catalogId"]?.stringValue, ScanRules.isAppleMusicID(catalogID) {
            id = catalogID
        }
        guard let id else { return common }
        common.kind = .track
        common.available = available
        common.id = id
        common.url = "https://music.apple.com/\(storefront)/song/\(id)"
        return common
    }

    // MARK: Section 3

    /// Parses a response body under the deck file's JSON text rules (UTF-8, a leading byte-order mark
    /// ignored, no duplicate member names, well-formed strings, at most 8 MiB) and rejects a number too
    /// large for a `Double`. Adapters pass every page body through it.
    public static func decodePage(_ data: Data) throws -> ProviderJSON {
        guard data.count <= DeckCodec.maximumBytes else { throw DeckError("Invalid playlist page: exceeds 8 MiB.") }
        do {
            return try JSONDecoder().decode(ProviderJSON.self, from: StrictJSON.validate(data))
        } catch let error as DeckError {
            throw DeckError("Invalid playlist page: \(error.message)")
        } catch {
            // `JSONDecoder` refuses a number it cannot represent, such as `1e999` or `1e-999`.
            throw DeckError("Invalid playlist page: a number cannot be represented.")
        }
    }

    /// Turns one provider response page into candidates and the next page's URL. Throws when the page as
    /// a whole is rejected; single bad items become `malformed` candidates.
    public static func normalizePage(provider: CandidateProvider, page: ProviderJSON, start: Int, storefront: String? = nil) throws -> (candidates: [Candidate], next: String?) {
        guard (0...maximumStart).contains(start) else { throw DeckError("Invalid playlist page: start is out of range.") }
        guard let page = page.objectValue else { throw DeckError("Invalid playlist page: not an object.") }
        switch provider {
        case .spotify:
            guard let items = page["items"]?.arrayValue else { throw DeckError("Invalid playlist page: items is not an array.") }
            var next: String?
            if let text = page["next"]?.stringValue, hasPrefix(text, "https://api.spotify.com/v1/playlists/"), CardURLPolicy.isSafeHTTPS(text) { next = text }
            return (items.enumerated().map { spotifyCandidate($1, position: start + $0) }, next)
        case .appleMusic:
            guard let storefront, isStorefront(storefront) else { throw DeckError("Invalid playlist page: storefront must be two letters.") }
            guard let data = page["data"]?.arrayValue else { throw DeckError("Invalid playlist page: data is not an array.") }
            let lower = ScanRules.asciiLowercased(storefront)
            var next: String?
            if let text = page["next"]?.stringValue, hasPrefix(text, "/v1/catalog/") || hasPrefix(text, "/v1/me/library/playlists/") {
                let absolute = "https://api.music.apple.com" + text
                if CardURLPolicy.isSafeHTTPS(absolute) { next = absolute }
            }
            return (data.enumerated().map { appleCandidate($1, position: start + $0, storefront: lower) }, next)
        }
    }

    // MARK: Section 4

    private static func sameOptional(_ first: String?, _ second: String?) -> Bool {
        switch (first, second) {
        case (nil, nil): return true
        case let (first?, second?): return ScanRules.same(first, second)
        default: return false
        }
    }

    /// Provider and track ID as one dictionary key, compared by UTF-8 bytes (never canonical equivalence);
    /// a missing ID is its own key.
    private static func trackKey(_ provider: String, _ id: String?) -> [UInt8] {
        Array(provider.utf8) + [0] + (id.map { [UInt8(ascii: "+")] + Array($0.utf8) } ?? [UInt8(ascii: "-")])
    }

    /// The first card in deck order with a link to each track, and with each ISRC.
    private static func indexDeck(_ deck: Deck) -> (byTrack: [[UInt8]: SongCard], byIsrc: [[UInt8]: SongCard]) {
        var byTrack = [[UInt8]: SongCard]()
        var byIsrc = [[UInt8]: SongCard]()
        for card in deck.cards {
            for link in card.links {
                guard let own = ScanRules.linkTrack(link) else { continue }
                let key = trackKey(own.provider.rawValue, own.id)
                if byTrack[key] == nil { byTrack[key] = card }
            }
            if let isrc = card.isrc, byIsrc[Array(isrc.utf8)] == nil { byIsrc[Array(isrc.utf8)] = card }
        }
        return (byTrack, byIsrc)
    }

    /// The integer value of the first four digits of `releaseDate`, when from 1850 through 2100.
    private static func proposedYear(_ candidate: Candidate) -> Int? {
        guard let date = candidate.releaseDate else { return nil }
        let digits = Array(date.unicodeScalars.prefix(4))
        guard digits.count == 4, digits.allSatisfy(ScanRules.isDigit) else { return nil }
        let year = digits.reduce(0) { $0 * 10 + Int($1.value - 48) }
        return (1850...2100).contains(year) ? year : nil
    }

    /// One entry per candidate, in order (section 4).
    public static func review(_ candidates: [Candidate], deck: Deck) -> [ReviewEntry] {
        let (byTrack, byIsrc) = indexDeck(deck)
        // The first earlier `track` candidate (lower index) with each track and ISRC.
        var earlierTrack = [[UInt8]: Candidate]()
        var earlierIsrc = [[UInt8]: Candidate]()
        return candidates.map { candidate in
            guard candidate.kind == .track else { return ReviewEntry(position: candidate.position, issues: [candidate.kind.rawValue]) }
            var entry = ReviewEntry(position: candidate.position)
            if candidate.available == false { entry.issues.append("unavailable") }
            let key = trackKey(candidate.provider.rawValue, candidate.id)
            let first = earlierTrack[key]
            if let first {
                entry.issues.append("duplicate")
                entry.duplicateOf = first.position
            } else if let isrc = candidate.isrc, let same = earlierIsrc[Array(isrc.utf8)] {
                entry.issues.append("sameIsrc")
                entry.sameIsrcAs = same.position
            }
            if first == nil { earlierTrack[key] = candidate }
            if let isrc = candidate.isrc, earlierIsrc[Array(isrc.utf8)] == nil { earlierIsrc[Array(isrc.utf8)] = candidate }
            if candidate.id != nil, let card = byTrack[key] {
                entry.issues.append("inDeck")
                entry.cardId = card.id
            } else if let isrc = candidate.isrc, let same = byIsrc[Array(isrc.utf8)] {
                entry.issues.append("sameIsrcInDeck")
                entry.isrcCardId = same.id
            }
            if let year = proposedYear(candidate) { entry.proposedYear = year } else { entry.issues.append("noYear") }
            return entry
        }
    }

    // MARK: Section 5

    /// The rules of candidate-v1.schema.json (there is no JSON Schema library here), checked on the
    /// decoded candidate.
    static func matchesCandidateSchema(_ candidate: Candidate) -> Bool {
        guard candidate.position >= 0 else { return false }
        let isTrack = candidate.kind == .track
        if isTrack {
            guard candidate.available != nil, candidate.id != nil, candidate.url != nil, candidate.title != nil, candidate.artist != nil else { return false }
        } else if candidate.available != nil || candidate.id != nil || candidate.url != nil {
            return false
        }
        if candidate.kind == .unsupported || candidate.kind == .missing || candidate.kind == .malformed {
            guard candidate.title == nil, candidate.artist == nil, candidate.album == nil, candidate.releaseDate == nil, candidate.isrc == nil else { return false }
        }
        if let id = candidate.id, !ScanRules.isSpotifyID(id), !ScanRules.isAppleMusicID(id) { return false }
        if let url = candidate.url, !isCandidateURL(url) { return false }
        for text in [candidate.title, candidate.artist, candidate.album] {
            if let text, !isVisible(text) { return false }
        }
        if let date = candidate.releaseDate, !isReleaseDate(date) { return false }
        if let isrc = candidate.isrc, !isISRC(isrc) { return false }
        return true
    }

    /// `https://open.spotify.com/track/<22 of [0-9A-Za-z]>` or `https://music.apple.com/<two a-z>/song/<1-15 digits>`.
    private static func isCandidateURL(_ url: String) -> Bool {
        let spotify = "https://open.spotify.com/track/"
        let apple = "https://music.apple.com/"
        if hasPrefix(url, spotify) { return ScanRules.isSpotifyID(ScanRules.string(url.unicodeScalars.dropFirst(spotify.unicodeScalars.count))) }
        guard hasPrefix(url, apple) else { return false }
        let parts = ScanRules.string(url.unicodeScalars.dropFirst(apple.unicodeScalars.count)).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        return parts.count == 3 && ScanRules.isASCII(parts[0], count: 2...2, { ("a"..."z").contains($0) }) && ScanRules.same(parts[1], "song") && ScanRules.isAppleMusicID(parts[2])
    }

    /// Step 2: a candidate `normalizePage` could have produced: it matches the schema, its `id` has its
    /// provider's shape and its `url` is the canonical URL for that ID.
    private static func isPromotable(_ candidate: Candidate) -> Bool {
        guard matchesCandidateSchema(candidate), let id = candidate.id, let url = candidate.url else { return false }
        switch candidate.provider {
        case .spotify:
            return ScanRules.isSpotifyID(id) && ScanRules.same(url, "https://open.spotify.com/track/" + id)
        case .appleMusic:
            guard ScanRules.isAppleMusicID(id), hasPrefix(url, "https://music.apple.com/") else { return false }
            let parts = ScanRules.string(url.unicodeScalars.dropFirst("https://music.apple.com/".unicodeScalars.count)).split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            return parts.count == 3 && ScanRules.same(parts[2], id)
        }
    }

    /// The deck with one new card appended, or an error. `deck.cards` may be empty. The result is
    /// validated by the deck rules for the deck's own `schemaVersion`.
    public static func promote(_ candidate: Candidate, into deck: Deck, decision: PromotionDecision) -> Result<Deck, PromotionError> {
        guard candidate.kind == .track else { return .failure(.notTrack) }
        guard isPromotable(candidate) else { return .failure(.invalid) }
        guard indexDeck(deck).byTrack[trackKey(candidate.provider.rawValue, candidate.id)] == nil else { return .failure(.inDeck) }
        let base = (candidate.provider == .spotify ? "sp-" : "am-") + (candidate.id ?? "")
        let taken = Set(deck.cards.map { Array($0.id.utf8) })
        var id = base
        var n = 2
        while taken.contains(Array(id.utf8)) {
            id = "\(base)-\(n)"
            n += 1
        }
        let link = ProviderLink(provider: candidate.provider == .spotify ? .spotify : .appleMusic, url: candidate.url ?? "", id: candidate.id, releaseDate: candidate.releaseDate)
        let card = SongCard(id: id, title: decision.title ?? candidate.title ?? "", artist: decision.artist ?? candidate.artist ?? "",
                            gameYear: decision.gameYear, isrc: candidate.isrc, links: [link])
        var result = deck
        result.cards.append(card)
        do { try DeckCodec.validate(result) } catch { return .failure(.invalid) }
        return .success(result)
    }
}
