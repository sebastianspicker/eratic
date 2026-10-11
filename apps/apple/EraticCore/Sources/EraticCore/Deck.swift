import Foundation

public struct Deck: Codable, Equatable, Sendable, Identifiable {
    public var schemaVersion: Int
    public var id: String
    public var title: String
    public var cards: [SongCard]
    /// Version 2: the clip start for cards without their own `clip`.
    public var defaultClipStartMs: Int?

    public init(schemaVersion: Int = 1, id: String, title: String, cards: [SongCard], defaultClipStartMs: Int? = nil) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.title = title
        self.cards = cards
        self.defaultClipStartMs = defaultClipStartMs
    }
}

public struct SongCard: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var artist: String
    public var gameYear: GameYear
    public var recordingVersion: String?
    public var isrc: String?
    public var links: [ProviderLink]
    public var officialCard: OfficialCard?
    /// Version 2 members.
    public var clip: CardClip?
    public var relatedTo: RelatedCard?
    public var difficulty: Int?

    public init(id: String, title: String, artist: String, gameYear: GameYear, recordingVersion: String? = nil, isrc: String? = nil, links: [ProviderLink] = [], officialCard: OfficialCard? = nil,
                clip: CardClip? = nil, relatedTo: RelatedCard? = nil, difficulty: Int? = nil) {
        self.id = id
        self.title = title
        self.artist = artist
        self.gameYear = gameYear
        self.recordingVersion = recordingVersion
        self.isrc = isrc
        self.links = links
        self.officialCard = officialCard
        self.clip = clip
        self.relatedTo = relatedTo
        self.difficulty = difficulty
    }
}

// Conceptual inspiration: JonasScholl/hitster's manual overrides and
// schnitzelburger/hitster-cards' separation of content from rendering.
// Preserve a curated answer independently of any provider's release date.
public struct GameYear: Codable, Equatable, Sendable {
    public var value: Int
    public var source: String
    public var note: String?

    public init(value: Int, source: String, note: String? = nil) {
        self.value = value
        self.source = source
        self.note = note
    }
}

public enum Provider: String, Codable, CaseIterable, Sendable {
    case spotify, appleMusic, youtube, other
}

public struct ProviderLink: Codable, Equatable, Sendable {
    public var provider: Provider
    public var url: String
    public var id: String?
    public var releaseDate: String?

    public init(provider: Provider, url: String, id: String? = nil, releaseDate: String? = nil) {
        self.provider = provider
        self.url = url
        self.id = id
        self.releaseDate = releaseDate
    }
}

public struct OfficialCard: Codable, Equatable, Sendable {
    public var url: String
    public var notes: String?

    public init(url: String, notes: String? = nil) {
        self.url = url
        self.notes = notes
    }
}

/// Version 2: where a card's clip starts, in milliseconds.
public struct CardClip: Codable, Equatable, Sendable {
    public var startMs: Int
    public init(startMs: Int) { self.startMs = startMs }
}

public enum Relation: String, Codable, CaseIterable, Sendable {
    case originalOf, coverOf, remasterOf
}

/// Version 2: this card's relation to another card of the same deck (Original or Imposter).
public struct RelatedCard: Codable, Equatable, Sendable {
    public var cardId: String
    public var relation: Relation
    public init(cardId: String, relation: Relation) {
        self.cardId = cardId
        self.relation = relation
    }
}

extension Deck {
    /// The same deck as version 2, nothing else changed, validated as version 2 (game-rules.md
    /// section 8.3). A valid version-2 deck is returned as is; an invalid deck throws.
    public func migrated() throws -> Deck {
        var deck = self
        deck.schemaVersion = 2
        try DeckCodec.validate(deck)
        return deck
    }

    /// `card.clip.startMs`, else `defaultClipStartMs`, else `nil` (the session chooses).
    public func clipStartMs(for card: SongCard) -> Int? {
        card.clip?.startMs ?? defaultClipStartMs
    }

    // Conceptual inspiration: JonasScholl/hitster's manual overrides; no source code copied.
    /// Replaces one card's curated year, leaving IDs and provider metadata untouched.
    public func updatingGameYear(_ gameYear: GameYear, forCardID id: String) throws -> Deck {
        guard let index = cards.firstIndex(where: { $0.id.utf8.elementsEqual(id.utf8) }) else { throw DeckError("Unknown card ID: \(id)") }
        var updated = self
        updated.cards[index].gameYear = gameYear
        try DeckCodec.validate(updated)
        return updated
    }

    /// Replaces one card's version-2 game fields (clip start, difficulty, related recording).
    /// Setting any of them on a version-1 deck migrates it to version 2; clearing them never downgrades.
    public func updatingGameFields(clip: CardClip?, difficulty: Int?, relatedTo: RelatedCard?, forCardID id: String) throws -> Deck {
        guard let index = cards.firstIndex(where: { $0.id == id }) else { throw DeckError("Unknown card ID: \(id)") }
        var updated = self
        updated.cards[index].clip = clip
        updated.cards[index].difficulty = difficulty
        updated.cards[index].relatedTo = relatedTo
        if clip != nil || difficulty != nil || relatedTo != nil { updated = try updated.migrated() }
        try DeckCodec.validate(updated)
        return updated
    }

    /// Replaces the deck's default clip start. Setting one on a version-1 deck migrates it to version 2.
    public func updatingDefaultClipStart(_ startMs: Int?) throws -> Deck {
        var updated = self
        updated.defaultClipStartMs = startMs
        if startMs != nil { updated = try updated.migrated() }
        try DeckCodec.validate(updated)
        return updated
    }
}
