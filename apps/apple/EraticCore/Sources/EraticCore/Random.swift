import Foundation

/// mulberry32 (game-rules.md section 1.3): one uint32 of state, wrapping arithmetic throughout.
public struct Mulberry32: Equatable, Sendable {
    public private(set) var state: UInt32

    public init(seed: UInt32) { state = seed }

    public mutating func next() -> UInt32 {
        state = state &+ 0x6D2B79F5
        var t = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return t ^ (t >> 14)
    }
}

/// An error from a rules primitive called with inputs outside its domain.
public struct GameRuleError: Error, LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}

/// The anchor pick kinds of game-rules.md section 1.6.
public enum AnchorKind: String, CaseIterable, Sendable {
    case beginning, middle, random, custom
}

/// A card as seen by `pickAnchors` and `imposterPairs`.
public struct AnchorCandidate: Equatable, Sendable {
    public var id: String
    public var year: Int
    public init(id: String, year: Int) {
        self.id = id
        self.year = year
    }
}

/// One playable Original-or-Imposter pair: card IDs, with `original` naming `a` or `b`'s card.
public struct ImposterPair: Equatable, Sendable {
    public var a: String
    public var b: String
    public var original: String
}

/// The deterministic primitives of game-rules.md section 1. No clock, no system randomness.
public enum GameRandom {
    public static func fnv1a32<Bytes: Sequence>(bytes: Bytes) -> UInt32 where Bytes.Element == UInt8 {
        var hash: UInt32 = 0x811C9DC5
        for byte in bytes {
            hash ^= UInt32(byte)
            hash = hash &* 0x01000193
        }
        return hash
    }

    /// Hashes the string's UTF-8 bytes.
    public static func fnv1a32(_ text: String) -> UInt32 { fnv1a32(bytes: text.utf8) }

    public static func deriveSeed(_ seed: UInt32, _ salt: String) -> UInt32 {
        fnv1a32(String(seed) + ":" + salt)
    }

    /// Fisher–Yates from the end, drawing `j = next() mod (i + 1)`.
    public static func shuffle<T>(_ items: [T], rng: inout Mulberry32) -> [T] {
        var result = items
        var i = result.count - 1
        while i >= 1 {
            let j = Int(rng.next() % UInt32(i + 1))
            result.swapAt(i, j)
            i -= 1
        }
        return result
    }

    public static func shuffle<T>(_ items: [T], seed: UInt32) -> [T] {
        var rng = Mulberry32(seed: seed)
        return shuffle(items, rng: &rng)
    }

    /// Code-point order. `String <` applies canonical equivalence, so it is never used for rules.
    public static func codePointPrecedes(_ first: String, _ second: String) -> Bool {
        first.utf8.lexicographicallyPrecedes(second.utf8)
    }

    /// Removes exact duplicates (by scalars, not Unicode equivalence) and sorts in code-point order.
    static func uniqueSorted(_ ids: [String]) -> [String] {
        var seen = Set<[UInt8]>()
        return ids.filter { seen.insert(Array($0.utf8)).inserted }.sorted(by: codePointPrecedes)
    }

    public static func drawOrder(_ cardIds: [String], seed: UInt32) -> [String] {
        shuffle(uniqueSorted(cardIds), seed: deriveSeed(seed, "draw"))
    }

    /// Higher or Lower with `closer` (section 1.5): `candidates` are the unused cards in `drawOrder` order.
    /// The first within `W = max(3, 20 − 2 × revealed)` years (1 to W), else the nearest nonzero distance
    /// (first on a tie), else the first candidate; nil for no candidates.
    public static func closerPick(_ candidates: [AnchorCandidate], referenceYear: Int, revealed: Int) -> String? {
        let window = max(3, 20 - 2 * revealed)
        if let near = candidates.first(where: { (1...window).contains(abs($0.year - referenceYear)) }) { return near.id }
        var nearest: AnchorCandidate?
        for candidate in candidates where candidate.year != referenceYear {
            if nearest.map({ abs(candidate.year - referenceYear) < abs($0.year - referenceYear) }) ?? true { nearest = candidate }
        }
        return (nearest ?? candidates.first)?.id
    }

    /// The day's cards: deck order never matters; the hash input is `date + deckId` concatenated.
    public static func dailySelection(_ cardIds: [String], date: String, deckId: String) -> [String] {
        Array(shuffle(uniqueSorted(cardIds), seed: fnv1a32(date + deckId)).prefix(5))
    }

    /// Section 1.6. Throws when a pick finds no remaining card, or `custom` has no year.
    public static func pickAnchors(_ cards: [AnchorCandidate], kind: AnchorKind, seed: UInt32, count: Int, year: Int? = nil) throws -> [String] {
        guard count >= 0 else { throw GameRuleError("count must not be negative.") }
        if kind == .custom, year == nil { throw GameRuleError("A custom anchor needs a year.") }
        var rng = Mulberry32(seed: deriveSeed(seed, "anchor"))
        var remaining = cards.sorted { $0.year != $1.year ? $0.year < $1.year : codePointPrecedes($0.id, $1.id) }
        var chosen = [String]()
        for _ in 0..<count {
            let n = remaining.count
            guard n > 0 else { throw GameRuleError("No card is left to pick as an anchor.") }
            let k = max(1, (n + 9) / 10)
            let indexes: [Int]
            switch kind {
            case .beginning:
                indexes = Array(0..<k)
            case .middle:
                let m = (n - 1) / 2
                let start = min(max(m - (k - 1) / 2, 0), n - k)
                indexes = Array(start..<(start + k))
            case .random:
                indexes = Array(0..<n)
            case .custom:
                let target = year!
                let best = remaining.map { abs($0.year - target) }.min()!
                indexes = remaining.indices.filter { abs(remaining[$0].year - target) == best }
            }
            let pick = indexes[Int(rng.next() % UInt32(indexes.count))]
            chosen.append(remaining.remove(at: pick).id)
        }
        return chosen
    }

    /// Section 1.5. The first pair not yet drawn (in either order) that shares no card with the last drawn pair, else the first not yet drawn.
    public static func nextImposterPair(_ pairs: [ImposterPair], drawn: [(String, String)]) -> ImposterPair? {
        func same(_ x: String, _ y: String) -> Bool { x.utf8.elementsEqual(y.utf8) }
        let open = pairs.filter { pair in
            !drawn.contains { (same($0.0, pair.a) && same($0.1, pair.b)) || (same($0.0, pair.b) && same($0.1, pair.a)) }
        }
        if let last = drawn.last,
           let apart = open.first(where: { ![$0.a, $0.b].contains { id in same(id, last.0) || same(id, last.1) } }) {
            return apart
        }
        return open.first
    }

    /// Section 8.3. `relatedTo` is the card's own relation, if any. Throws on duplicate card IDs.
    public static func imposterPairs(_ cards: [(id: String, relatedTo: RelatedCard?)], seed: UInt32) throws -> [ImposterPair] {
        func isDerived(_ relation: Relation?) -> Bool { relation == .coverOf || relation == .remasterOf }
        var byID = [[UInt8]: RelatedCard?]()
        for card in cards {
            guard byID[Array(card.id.utf8)] == nil else { throw GameRuleError("Duplicate card ID: \(card.id).") }
            byID[Array(card.id.utf8)] = card.relatedTo
        }
        var pairs = [(original: String, other: String)]()
        for card in cards {
            guard let related = card.relatedTo, let target = byID[Array(related.cardId.utf8)] else { continue }
            if isDerived(related.relation), !isDerived(target?.relation) {
                pairs.append((related.cardId, card.id))
            } else if related.relation == .originalOf {
                pairs.append((card.id, related.cardId))
            }
        }
        var seen = Set<[[UInt8]]>()
        pairs = pairs.filter { seen.insert([Array($0.original.utf8), Array($0.other.utf8)]).inserted }
        pairs.sort { !$0.original.utf8.elementsEqual($1.original.utf8) ? codePointPrecedes($0.original, $1.original) : codePointPrecedes($0.other, $1.other) }
        var rng = Mulberry32(seed: deriveSeed(seed, "pairs"))
        let shuffled = shuffle(pairs, rng: &rng)
        return shuffled.map { pair in
            rng.next() % 2 == 0
                ? ImposterPair(a: pair.original, b: pair.other, original: pair.original)
                : ImposterPair(a: pair.other, b: pair.original, original: pair.original)
        }
    }
}
