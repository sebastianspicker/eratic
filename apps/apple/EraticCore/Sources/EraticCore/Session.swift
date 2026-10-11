import Foundation

/// The game modes of game-rules.md section 6.
public enum GameMode: String, CaseIterable, Sendable {
    case ladder, timeline, bullseye, eraSort, higherLower, relay, lineup, daily, imposter
}

/// A snapshot of a drawn card: its ID, curated year and that year's era (section 5.1).
public struct CardRef: Equatable, Sendable {
    public var cardId: String
    public var year: Int
    public var era: String

    public init(cardId: String, year: Int, era: String) {
        self.cardId = cardId
        self.year = year
        self.era = era
    }

    /// The reference for `year`, with its era filled in.
    public init(cardId: String, year: Int) {
        self.init(cardId: cardId, year: year, era: EraBoundaries.eraOf(year))
    }
}

/// A player or team. Names are personal data and stay on the device.
public struct SessionPlayer: Equatable, Sendable {
    public var id: String
    public var name: String
    public var members: [String]?

    public init(id: String, name: String, members: [String]? = nil) {
        self.id = id
        self.name = name
        self.members = members
    }
}

public enum PairSide: String, CaseIterable, Sendable {
    case a, b
}

/// Every action of sections 5 and 6, without its `at` time.
public enum GameAction: Equatable, Sendable {
    case anchor(playerId: String?, card: CardRef)
    case reference(card: CardRef)
    case draw(card: CardRef)
    case drawSet(cards: [CardRef])
    case drawPair(a: CardRef, b: CardRef, original: PairSide)
    case sdDraw(cards: [CardRef])
    case guess(playerId: String, year: Int)
    case pickEra(playerId: String, era: String)
    case place(playerId: String, slot: Int)
    case challenge(playerId: String, slot: Int)
    case nameIt(playerId: String, titleOK: Bool, artistOK: Bool)
    case wager(playerId: String, chips: Int)
    case step(index: Int)
    case lock(playerId: String, year: Int?)
    case mark(playerId: String, titleOK: Bool, artistOK: Bool)
    case call(playerId: String, call: HigherLowerCall)
    case order(playerId: String, order: [String])
    case choose(playerId: String, pick: PairSide, year: Int?)
    case sdGuess(playerId: String, year: Int)
    case sdOrder(playerId: String, order: [String])
    case sdName(playerId: String?)
    case reveal
    case clip(fromMs: Int, lengthMs: Int?)
    case skip
    case end

    /// The action's `type` in a session file.
    public var type: String {
        switch self {
        case .anchor: return "anchor"
        case .reference: return "reference"
        case .draw: return "draw"
        case .drawSet: return "drawSet"
        case .drawPair: return "drawPair"
        case .sdDraw: return "sdDraw"
        case .guess: return "guess"
        case .pickEra: return "pickEra"
        case .place: return "place"
        case .challenge: return "challenge"
        case .nameIt: return "nameIt"
        case .wager: return "wager"
        case .step: return "step"
        case .lock: return "lock"
        case .mark: return "mark"
        case .call: return "call"
        case .order: return "order"
        case .choose: return "choose"
        case .sdGuess: return "sdGuess"
        case .sdOrder: return "sdOrder"
        case .sdName: return "sdName"
        case .reveal: return "reveal"
        case .clip: return "clip"
        case .skip: return "skip"
        case .end: return "end"
        }
    }
}

/// An action with `at`, milliseconds since the session started.
public struct SessionAction: Equatable, Sendable {
    public var at: Int
    public var action: GameAction

    public init(at: Int, _ action: GameAction) {
        self.at = at
        self.action = action
    }
}

// MARK: - Mode options (section 6). Defaults match the contract; ranges are checked by the engine.

public struct BullseyeOptions: Equatable, Sendable {
    public var rounds = 10
    public var stakes = false
    public init(rounds: Int = 10, stakes: Bool = false) {
        self.rounds = rounds
        self.stakes = stakes
    }
}

public struct EraSortOptions: Equatable, Sendable {
    public var rounds = 10
    public var kids = false
    public init(rounds: Int = 10, kids: Bool = false) {
        self.rounds = rounds
        self.kids = kids
    }
}

public enum TimelineOwnership: String, CaseIterable, Sendable {
    case personal, shared
}

public enum TimelineClip: String, CaseIterable, Sendable {
    case full, thirtySeconds = "30s", tenSeconds = "10s"
}

public struct TimelineOptions: Equatable, Sendable {
    public var ownership: TimelineOwnership = .personal
    public var anchor: AnchorKind = .random
    public var anchorYear: Int?
    public var target = 10
    public var challenges = true
    public var tokens = 2
    public var nameIt = false
    public var stakes = false
    public var clip: TimelineClip = .full
    public init() {}
}

public enum LadderGuess: String, CaseIterable, Sendable {
    case name, year, both
}

public enum LadderClipStart: String, CaseIterable, Sendable {
    case card, skipIntro, zero
}

public struct LadderOptions: Equatable, Sendable {
    public static let defaultSteps = [1000, 5000, 10000, 30000, 60000]
    public var rounds = 10
    public var steps = LadderOptions.defaultSteps
    public var guess: LadderGuess = .name
    public var clipStart: LadderClipStart = .card
    public var stakes = false
    public init() {}
}

public struct HigherLowerOptions: Equatable, Sendable {
    public var cards = 10
    public init(cards: Int = 10) { self.cards = cards }
}

public struct RelayOptions: Equatable, Sendable {
    public var target = 12
    public var lives = 3
    public var anchor: AnchorKind = .random
    public var anchorYear: Int?
    public var nameIt = false
    public init() {}
}

public struct LineupOptions: Equatable, Sendable {
    public var k = 4
    public var rounds = 5
    public var clipMs = 10000
    public init(k: Int = 4, rounds: Int = 5, clipMs: Int = 10000) {
        self.k = k
        self.rounds = rounds
        self.clipMs = clipMs
    }
}

/// No defaults: both members are required.
public struct DailyOptions: Equatable, Sendable {
    public var date: String
    public var cards: [String]
    public init(date: String, cards: [String]) {
        self.date = date
        self.cards = cards
    }
}

public struct ImposterOptions: Equatable, Sendable {
    public var rounds = 5
    public init(rounds: Int = 5) { self.rounds = rounds }
}

/// A mode with its options; the session's `mode` is derived from it.
public enum GameOptions: Equatable, Sendable {
    case ladder(LadderOptions)
    case timeline(TimelineOptions)
    case bullseye(BullseyeOptions)
    case eraSort(EraSortOptions)
    case higherLower(HigherLowerOptions)
    case relay(RelayOptions)
    case lineup(LineupOptions)
    case daily(DailyOptions)
    case imposter(ImposterOptions)

    public var mode: GameMode {
        switch self {
        case .ladder: return .ladder
        case .timeline: return .timeline
        case .bullseye: return .bullseye
        case .eraSort: return .eraSort
        case .higherLower: return .higherLower
        case .relay: return .relay
        case .lineup: return .lineup
        case .daily: return .daily
        case .imposter: return .imposter
        }
    }

    /// Whether the Stakes modifier is on.
    public var stakes: Bool {
        switch self {
        case let .ladder(options): return options.stakes
        case let .timeline(options): return options.stakes
        case let .bullseye(options): return options.stakes
        default: return false
        }
    }
}

/// A `session-v1` file (game-rules.md section 4). Scores are never stored: replay derives them.
public struct GameSession: Equatable, Sendable {
    public static let format = "eratic-session"
    public static let version = 1

    public var id: String
    public var createdAt: String
    public var deckId: String
    public var deckTitle: String
    public var options: GameOptions
    public var seed: UInt32
    public var players: [SessionPlayer]
    public var actions: [SessionAction]

    public var mode: GameMode { options.mode }

    public init(id: String, createdAt: String, deckId: String, deckTitle: String, options: GameOptions, seed: UInt32, players: [SessionPlayer], actions: [SessionAction] = []) {
        self.id = id
        self.createdAt = createdAt
        self.deckId = deckId
        self.deckTitle = deckTitle
        self.options = options
        self.seed = seed
        self.players = players
        self.actions = actions
    }
}
