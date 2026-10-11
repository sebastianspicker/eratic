import Foundation

// A read-only view of the engine state for the apps' host screens. Nothing here changes a rule;
// the apps read these values and send actions through `GameEngine.apply`.

/// The pair in play in Original or Imposter.
public struct PairInPlay: Equatable, Sendable {
    public let a: CardRef
    public let b: CardRef
    public let original: PairSide
}

/// A Snippet Ladder lock: the step it was given at and its year, if any.
public struct LockInPlay: Equatable, Sendable {
    public let step: Int
    public let year: Int?
}

/// Host marks for a song's title and artist (Name It, Ladder marks).
public struct MarksInPlay: Equatable, Sendable {
    public let titleOK: Bool
    public let artistOK: Bool
}

/// A Timeline challenge made this turn.
public struct ChallengeInPlay: Equatable, Sendable {
    public let playerId: String
    public let slot: Int
}

/// An Original or Imposter choice.
public struct ChoiceInPlay: Equatable, Sendable {
    public let pick: PairSide
    public let year: Int?
}

/// Sudden death as the host screen shows it (section 5.5).
public struct SuddenDeathInPlay: Equatable, Sendable {
    public let kind: SuddenDeathKind
    /// The players still tied, in turn order.
    public let players: [String]
    /// The number of cards `sdDraw` needs.
    public let cardCount: Int
    /// The sudden-death cards in play; empty until `sdDraw`.
    public let cards: [CardRef]
    public let guesses: [String: Int]
    public let orders: [String: [String]]
    /// True once `sdName` was given for the card in play.
    public let nameGiven: Bool
    public let named: String?
    public let winner: String?
}

extension GameMode {
    /// The mode's player-count range (section 6).
    public var playerRange: ClosedRange<Int> { GameEngine.playerRange(self) }
}

extension GameState {
    /// The player whose turn it is, in modes that have one, until the game finishes.
    public var activePlayerID: String? {
        guard [.timeline, .relay, .higherLower].contains(mode), phase != .finished else { return nil }
        return activePlayer
    }

    /// The single card in play (`draw`), or nil.
    public var currentCard: CardRef? { card }

    /// The Lineup set in play; empty otherwise.
    public var currentSet: [CardRef] { cardSet }

    public var currentPair: PairInPlay? {
        pair.map { PairInPlay(a: $0.a, b: $0.b, original: $0.original) }
    }

    /// A personal Timeline by player; `nil` gives the shared Timeline or the Relay line.
    public func timeline(for playerID: String?) -> [CardRef] {
        guard let playerID else { return line }
        return exactPlayerID(playerID).flatMap { timelines[$0] } ?? []
    }

    /// The Snippet Ladder step played for the card in play, −1 before the first.
    public var ladderStep: Int { step }

    /// The face-up Higher or Lower reference card.
    public var referenceCard: CardRef? { reference }

    /// Sudden death while it is played, and after it decided the game (then `winner` is set).
    public var suddenDeathInfo: SuddenDeathInPlay? {
        guard let sd = suddenDeath, phase == .suddenDeath || phase == .suddenDeathOpen || sd.winner != nil else { return nil }
        return SuddenDeathInPlay(kind: sd.kind, players: sd.players, cardCount: sd.kind == .lineup ? suddenDeathLineupSize : 1,
                                 cards: sd.cards, guesses: sd.guesses, orders: sd.orders, nameGiven: sd.nameGiven, named: sd.named, winner: sd.winner)
    }

    /// Chips held, with stakes on; nil otherwise.
    public func chips(for playerID: String) -> Int? {
        options.stakes ? exactPlayerID(playerID).flatMap { chips[$0] } ?? 0 : nil
    }

    /// Timeline challenge tokens held; nil in other modes.
    public func tokens(for playerID: String) -> Int? {
        mode == .timeline ? exactPlayerID(playerID).map { stat("tokens", $0) } ?? 0 : nil
    }

    /// True once these two cards were paired in this session (Original or Imposter), even if the pair was skipped.
    public func wasPaired(_ first: String, _ second: String) -> Bool {
        usedPairs.contains([Array(first.utf8), Array(second.utf8)].sorted { $0.lexicographicallyPrecedes($1) })
    }

    /// Every card ID that has entered the session.
    public var usedCardIDs: Set<String> { Set(used.map { String(decoding: $0, as: UTF8.self) }) }

    /// True once the active player has placed the card in play (Timeline, Relay).
    public var hasPlaced: Bool { inputs.placement != nil }

    // MARK: Inputs for the card in play, hidden by the apps until the reveal.

    public var guesses: [String: Int] { inputs.guesses }
    /// Era picks (Era Sort, Daily rounds 1–3).
    public var picks: [String: String] { inputs.eras }
    public var wagers: [String: Int] { inputs.wagers }
    public var placement: Int? { inputs.placement }
    public var challenges: [ChallengeInPlay] { inputs.challenges.map { ChallengeInPlay(playerId: $0.player, slot: $0.slot) } }
    public var nameItMarks: MarksInPlay? { inputs.nameIt.map { MarksInPlay(titleOK: $0.titleOK, artistOK: $0.artistOK) } }
    public var locks: [String: LockInPlay] { inputs.locks.mapValues { LockInPlay(step: $0.step, year: $0.year) } }
    public var marks: [String: MarksInPlay] { inputs.marks.mapValues { MarksInPlay(titleOK: $0.titleOK, artistOK: $0.artistOK) } }
    public var call: HigherLowerCall? { inputs.call }
    public var orders: [String: [String]] { inputs.orders }
    public var choices: [String: ChoiceInPlay] { inputs.choices.mapValues { ChoiceInPlay(pick: $0.pick, year: $0.year) } }

    /// Whether the player must wager on the card in play before the reveal (Stakes) and hasn't.
    public func owesWager(_ playerID: String) -> Bool {
        guard let playerID = exactPlayerID(playerID) else { return false }
        guard options.stakes, phase == .open, mustWager(playerID), (chips[playerID] ?? 0) >= 1, inputs.wagers[playerID] == nil else { return false }
        return mode != .timeline || inputs.placement != nil
    }

    /// Players, in turn order, who still owe an input the reveal needs: a guess, pick, placement,
    /// lock, mark, call, order, choice, required wager or sudden-death input.
    public var pendingInputs: [String] {
        let everyone = playerIDs
        switch phase {
        case .open:
            return everyone.filter { player in owesModeInput(player) || owesWager(player) }
        case .suddenDeathOpen:
            guard let sd = suddenDeath else { return [] }
            switch sd.kind {
            case .closestYear: return sd.players.filter { sd.guesses[$0] == nil }
            case .lineup: return sd.players.filter { sd.orders[$0] == nil }
            case .firstToName: return sd.nameGiven ? [] : sd.players
            }
        default:
            return []
        }
    }

    private func owesModeInput(_ player: String) -> Bool {
        switch options {
        case .bullseye: return inputs.guesses[player] == nil
        case .eraSort: return inputs.eras[player] == nil
        case .daily: return round < 3 ? inputs.eras[player] == nil : inputs.guesses[player] == nil
        case .timeline, .relay, .higherLower:
            guard player == activePlayer else { return false }
            return mode == .higherLower ? inputs.call == nil : inputs.placement == nil
        case let .ladder(ladder):
            if let _ = inputs.locks[player] { return ladder.guess != .year && inputs.marks[player] == nil }
            return step < ladder.steps.count - 1
        case .lineup: return inputs.orders[player] == nil
        case .imposter: return inputs.choices[player] == nil
        }
    }

    /// True exactly when `reveal` would be accepted now.
    public var canReveal: Bool {
        (try? GameEngine.apply(SessionAction(at: lastAt, .reveal), to: self)) != nil
    }
}
