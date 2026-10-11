import Foundation

public struct DeckError: Error, LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}

public enum DeckCodec {
    public static let maximumBytes = 8 * 1024 * 1024

    public static func decode(_ data: Data) throws -> Deck {
        guard data.count <= maximumBytes else { throw DeckError("Deck exceeds the 8 MiB import limit.") }
        let json = try StrictJSON.validate(data)
        let object = try JSONSerialization.jsonObject(with: json)
        try inspectStructure(object)
        let deck = try JSONDecoder().decode(Deck.self, from: json)
        try validate(deck)
        return deck
    }

    public static func encode(_ deck: Deck) throws -> Data {
        try validate(deck)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(deck)
        // Formatting must not make an otherwise valid imported deck unsavable.
        if data.count > maximumBytes {
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            data = try encoder.encode(deck)
        }
        guard data.count <= maximumBytes else { throw DeckError("Deck exceeds the 8 MiB export limit.") }
        return data
    }

    public static func validate(_ deck: Deck) throws {
        guard deck.schemaVersion == 1 || deck.schemaVersion == 2 else { throw DeckError("Unsupported schemaVersion; expected 1 or 2.") }
        let version2 = deck.schemaVersion == 2
        try identifier(deck.id, "deck.id")
        if let start = deck.defaultClipStartMs {
            guard version2 else { throw DeckError("deck.defaultClipStartMs requires schemaVersion 2.") }
            guard (0...3_600_000).contains(start) else { throw DeckError("deck.defaultClipStartMs must be 0–3600000.") }
        }
        try text(deck.title, "deck.title")
        guard (1...2000).contains(deck.cards.count) else { throw DeckError("Deck must contain 1–2000 cards.") }
        // Card IDs compare as exact strings, never under canonical equivalence (game-rules.md section 1.1).
        var ids = Set<[UInt8]>()
        for (index, card) in deck.cards.enumerated() {
            let path = "cards[\(index)]"
            try identifier(card.id, "\(path).id")
            guard ids.insert(Array(card.id.utf8)).inserted else { throw DeckError("Duplicate card ID: \(card.id).") }
            try text(card.title, "\(path).title")
            try text(card.artist, "\(path).artist")
            guard (1850...2100).contains(card.gameYear.value) else { throw DeckError("\(path).gameYear must be 1850–2100.") }
            try text(card.gameYear.source, "\(path).gameYear.source")
            try optionalText(card.gameYear.note, "\(path).gameYear.note")
            try optionalText(card.recordingVersion, "\(path).recordingVersion")
            if let isrc = card.isrc, !matches(isrc, "^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$") {
                throw DeckError("\(path).isrc is invalid.")
            }
            guard card.links.count <= 20 else { throw DeckError("\(path).links exceeds 20 links.") }
            for (linkIndex, link) in card.links.enumerated() {
                guard CardURLPolicy.isSafeHTTPS(link.url) else { throw DeckError("\(path).links[\(linkIndex)].url must be a safe HTTPS URL.") }
                try optionalText(link.id, "\(path).links[\(linkIndex)].id")
                try optionalText(link.releaseDate, "\(path).links[\(linkIndex)].releaseDate")
            }
            if let official = card.officialCard {
                guard CardURLPolicy.isOfficialCardURL(official.url) else { throw DeckError("\(path).officialCard.url is not a recognized official-card URL pattern.") }
                try optionalText(official.notes, "\(path).officialCard.notes")
            }
            if card.clip != nil || card.relatedTo != nil || card.difficulty != nil {
                guard version2 else { throw DeckError("\(path) uses version-2 members; schemaVersion must be 2.") }
            }
            if let clip = card.clip, !(0...3_600_000).contains(clip.startMs) { throw DeckError("\(path).clip.startMs must be 0–3600000.") }
            if let difficulty = card.difficulty, !(1...5).contains(difficulty) { throw DeckError("\(path).difficulty must be 1–5.") }
            if let related = card.relatedTo {
                try identifier(related.cardId, "\(path).relatedTo.cardId")
                guard !related.cardId.utf8.elementsEqual(card.id.utf8), deck.cards.contains(where: { $0.id.utf8.elementsEqual(related.cardId.utf8) }) else {
                    throw DeckError("\(path).relatedTo.cardId must name another card in the deck.")
                }
            }
        }
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }

    private static func identifier(_ value: String, _ path: String) throws {
        guard matches(value, "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$") else { throw DeckError("\(path) must be a stable 1–64 character ID.") }
    }

    private static func text(_ value: String, _ path: String) throws {
        guard isVisibleText(value, maximum: 500) else {
            throw DeckError("\(path) must contain 1–500 characters, not only whitespace.")
        }
    }

    /// 1 to `maximum` code points, at least one outside the ECMAScript whitespace set.
    static func isVisibleText(_ value: String, maximum: Int) -> Bool {
        // Unicode scalar count matches JSON Schema / browser string validation.
        (1...maximum).contains(value.unicodeScalars.count) && value.unicodeScalars.contains(where: { !ecmaScriptWhitespace.contains($0.value) })
    }

    static func isIdentifier(_ value: String, maximumLength: Int = 64) -> Bool {
        matches(value, "^[A-Za-z0-9][A-Za-z0-9_-]{0,\(maximumLength - 1)}$")
    }

    /// The exact ECMAScript `\s` set, so "visible" agrees with the schema's `\S` pattern.
    private static let ecmaScriptWhitespace: Set<UInt32> = [
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
        0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
        0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    ]

    private static func optionalText(_ value: String?, _ path: String) throws {
        if let value { try text(value, path) }
    }

    private static func inspectStructure(_ raw: Any) throws {
        // Version-2 members are unknown fields in any other version.
        let version2 = StrictJSON.members(raw)?.first(where: { $0.name.utf8.elementsEqual("schemaVersion".utf8) }).map { isTwo($0.value) } ?? false
        let deck = try object(raw, allowed: Set(["schemaVersion", "id", "title", "cards"]).union(version2 ? ["defaultClipStartMs"] : []), path: "deck")
        guard let cards = deck["cards"] as? [Any] else { throw DeckError("cards must be an array.") }
        let cardMembers: Set<String> = ["id", "title", "artist", "gameYear", "recordingVersion", "isrc", "links", "officialCard"]
        for (index, rawCard) in cards.enumerated() {
            let path = "cards[\(index)]"
            let card = try object(rawCard, allowed: cardMembers.union(version2 ? ["clip", "relatedTo", "difficulty"] : []), path: path)
            if let clip = card["clip"] { _ = try object(clip, allowed: ["startMs"], path: "\(path).clip") }
            if let related = card["relatedTo"] { _ = try object(related, allowed: ["cardId", "relation"], path: "\(path).relatedTo") }
            guard let year = card["gameYear"] else { throw DeckError("\(path).gameYear is required.") }
            _ = try object(year, allowed: ["value", "source", "note"], path: "\(path).gameYear")
            guard let links = card["links"] as? [Any] else { throw DeckError("\(path).links must be an array.") }
            for (linkIndex, link) in links.enumerated() {
                _ = try object(link, allowed: ["provider", "url", "id", "releaseDate"], path: "\(path).links[\(linkIndex)]")
            }
            if let official = card["officialCard"] {
                _ = try object(official, allowed: ["url", "notes"], path: "\(path).officialCard")
            }
        }
    }

    private static func isTwo(_ raw: Any) -> Bool {
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
        return number.doubleValue == 2
    }

    /// Member names must match exactly; the result is keyed by the allowed spelling.
    private static func object(_ raw: Any, allowed: Set<String>, path: String) throws -> [String: Any] {
        guard let members = StrictJSON.members(raw) else { throw DeckError("\(path) must be an object.") }
        var values = [String: Any]()
        for (key, value) in members {
            guard let name = StrictJSON.exactName(key, in: allowed) else { throw DeckError("Unknown field: \(path).\(key).") }
            guard !(value is NSNull) else { throw DeckError("Null is not allowed: \(path).\(key).") }
            values[name] = value
        }
        return values
    }
}
