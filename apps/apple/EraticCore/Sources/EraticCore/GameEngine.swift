import Foundation

/// Section 5.2.
public enum GamePhase: String, Sendable {
    case setup, awaitingDraw, open, suddenDeath, suddenDeathOpen, finished
}

/// Section 5.5.
public enum SuddenDeathKind: String, Sendable {
    case closestYear, firstToName, lineup
}

/// A rejected session: `actionIndex` is the 0-based index of the first rejected action,
/// or −1 for invalid setup (options or player count).
public struct GameError: Error, LocalizedError, Equatable {
    public let actionIndex: Int
    public let message: String
    public var errorDescription: String? { actionIndex < 0 ? "Invalid setup: \(message)" : "Action \(actionIndex): \(message)" }
    public init(actionIndex: Int, message: String) {
        self.actionIndex = actionIndex
        self.message = message
    }
}

/// A rule violation inside the engine, given its action index by `GameEngine.apply`.
struct Rejection: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

func require(_ condition: Bool, _ message: @autoclosure () -> String) throws {
    if !condition { throw Rejection(message()) }
}

struct Marks: Equatable, Sendable {
    var titleOK: Bool
    var artistOK: Bool
}

struct Challenge: Equatable, Sendable {
    var player: String
    var slot: Int
}

struct LadderLock: Equatable, Sendable {
    var step: Int
    var year: Int?
}

struct ImposterChoice: Equatable, Sendable {
    var pick: PairSide
    var year: Int?
}

struct DrawnPair: Equatable, Sendable {
    var a: CardRef
    var b: CardRef
    var original: PairSide
    var originalCard: CardRef { original == .a ? a : b }
}

/// Every input given for the card (or set or pair) in play; `skip` drops it all.
struct CardInputs: Equatable, Sendable {
    var guesses: [String: Int] = [:]
    var eras: [String: String] = [:]
    var wagers: [String: Int] = [:]
    var placement: Int?
    var challenges: [Challenge] = []
    var nameIt: Marks?
    var locks: [String: LadderLock] = [:]
    /// Ladder players in the order they locked (the buzzer goes to the first who scores).
    var lockOrder: [String] = []
    var marks: [String: Marks] = [:]
    var call: HigherLowerCall?
    /// Higher or Lower `everyone` calls, one per player still in.
    var calls: [String: HigherLowerCall] = [:]
    var orders: [String: [String]] = [:]
    var choices: [String: ImposterChoice] = [:]
}

struct SuddenDeathState: Equatable, Sendable {
    var kind: SuddenDeathKind
    /// The players still tied, in turn order.
    var players: [String]
    /// The main standings when sudden death began; scores no longer change.
    var base: [[String]]
    var cards: [CardRef] = []
    var guesses: [String: Int] = [:]
    var orders: [String: [String]] = [:]
    var nameGiven = false
    var named: String?
    /// One group per sudden-death round that eliminated someone, oldest first.
    var eliminated: [[String]] = []
    var winner: String?

    mutating func clearRound() {
        cards = []
        guesses = [:]
        orders = [:]
        nameGiven = false
        named = nil
    }
}

/// The engine's state after any number of actions. Build it with `GameEngine.start` and `apply`.
public struct GameState: Equatable, Sendable {
    public let options: GameOptions
    public let players: [SessionPlayer]
    public let seed: UInt32
    public internal(set) var phase: GamePhase
    /// Reveals counted so far, not sudden-death reveals.
    public internal(set) var round = 0
    /// The number of actions applied.
    public internal(set) var actionCount = 0

    var lastAt = 0
    /// Card IDs as UTF-8 bytes: IDs compare exactly, never under canonical equivalence.
    var used = Set<[UInt8]>()
    var activeIndex = 0
    var points: [String: Int] = [:]
    var chips: [String: Int] = [:]
    /// Per-player counters by summary name: exact, distance, rightEras, tokens, wrong, added, usedMs, exactYears, buzzers, perfect, bonuses, streaks, lives.
    var stats: [String: [String: Int]] = [:]
    var card: CardRef?
    var cardSet: [CardRef] = []
    var pair: DrawnPair?
    var inputs = CardInputs()
    var timelines: [String: [CardRef]] = [:]
    /// The shared Timeline line, or the Relay line.
    var line: [CardRef] = []
    var anchorsPlaced = 0
    var step = -1
    var reference: CardRef?
    /// Higher or Lower versus players out, in elimination order.
    public internal(set) var eliminated: [String] = []
    /// The reveal (round number) that eliminated each Higher or Lower player.
    var eliminatedRound: [String: Int] = [:]
    /// Relay lives.
    public internal(set) var lives = 0
    /// Relay outcome: `playing`, `won`, `lost` or `ended`.
    public internal(set) var outcome = "playing"
    var usedPairs = Set<[[UInt8]]>()
    var dailyEras: [String] = []
    var suddenDeath: SuddenDeathState?

    public var mode: GameMode { options.mode }
    var playerIDs: [String] { players.map(\.id) }
    var activePlayer: String { players[activeIndex].id }
    /// Higher or Lower with `play: everyone`: no active player, per-player lives (section 6.5).
    var everyonePlays: Bool {
        if case let .higherLower(higherLower) = options { return higherLower.play == .everyone }
        return false
    }
    /// Whether the mode has an active player (Timeline, Relay, Higher or Lower in turns).
    var hasActivePlayer: Bool { [.timeline, .relay, .higherLower].contains(mode) && !everyonePlays }
    /// Higher or Lower players still in, in turn order.
    var playersStillIn: [String] {
        playerIDs.filter { !eliminated.contains($0) && (!everyonePlays || stat("lives", $0) > 0) }
    }

    init(options: GameOptions, players: [SessionPlayer], seed: UInt32) {
        self.options = options
        self.players = players
        self.seed = seed
        switch options.mode {
        case .timeline, .relay, .higherLower: phase = .setup
        default: phase = .awaitingDraw
        }
        for player in players {
            points[player.id] = 0
            if options.stakes { chips[player.id] = 5 }
        }
        for name in GameState.statNames(options) {
            stats[name] = Dictionary(uniqueKeysWithValues: players.map { ($0.id, 0) })
        }
        switch options {
        case let .timeline(timeline):
            stats["tokens"] = Dictionary(uniqueKeysWithValues: players.map { ($0.id, timeline.tokens) })
            if timeline.ownership == .personal { timelines = Dictionary(uniqueKeysWithValues: players.map { ($0.id, []) }) }
        case let .relay(relay):
            lives = relay.lives
        case let .higherLower(higherLower) where higherLower.play == .everyone:
            stats["lives"] = Dictionary(uniqueKeysWithValues: players.map { ($0.id, higherLower.startingLives) })
        case let .ladder(ladder) where ladder.buzzer:
            stats["buzzers"] = Dictionary(uniqueKeysWithValues: players.map { ($0.id, 0) })
        default: break
        }
    }

    static func statNames(_ options: GameOptions) -> [String] {
        switch options.mode {
        case .bullseye: return ["exact", "distance"]
        case .eraSort: return ["rightEras"]
        case .timeline: return ["tokens", "wrong", "added"]
        case .ladder: return ["usedMs", "exactYears"]
        case .higherLower: return ["streaks"]
        case .lineup: return ["perfect"]
        case .imposter: return ["bonuses"]
        case .relay, .daily: return []
        }
    }

    func stat(_ name: String, _ player: String) -> Int { stats[name]?[player] ?? 0 }
    mutating func bump(_ name: String, _ player: String, by amount: Int = 1) { stats[name, default: [:]][player, default: 0] += amount }

    /// Points plus held chips with stakes; Timeline counts cards (section 6.3), Higher or Lower the streak (6.5).
    func score(_ player: String) -> Int {
        let base: Int
        if case let .timeline(timeline) = options {
            base = timeline.ownership == .personal ? timelines[player]?.count ?? 0 : stat("added", player)
        } else if options.mode == .higherLower {
            base = stat("streaks", player)
        } else {
            base = points[player] ?? 0
        }
        return base + (chips[player] ?? 0)
    }
}

public enum GameEngine {
    /// Checks the options and player count (errors at index −1) and returns the initial state.
    public static func start(options: GameOptions, players: [SessionPlayer], seed: UInt32 = 0, sessionVersion: Int = GameSession.version) throws -> GameState {
        do {
            try validateSetup(options, players, sessionVersion: sessionVersion)
        } catch let rejection as Rejection {
            throw GameError(actionIndex: -1, message: rejection.message)
        }
        return GameState(options: options, players: players, seed: seed)
    }

    /// Applies one action, or throws a `GameError` carrying the action's index.
    public static func apply(_ action: SessionAction, to state: GameState) throws -> GameState {
        var next = state
        do {
            try require(state.phase != .finished, "The game is finished.")
            try require(action.at >= 0 && action.at >= state.lastAt, "at must be ≥ 0 and ≥ the previous action's at.")
            try next.handle(action.action)
        } catch let rejection as Rejection {
            throw GameError(actionIndex: state.actionCount, message: rejection.message)
        } catch let error as GameRuleError {
            throw GameError(actionIndex: state.actionCount, message: error.message)
        }
        next.lastAt = action.at
        next.actionCount += 1
        return next
    }

    public static func replay(_ session: GameSession) throws -> GameState {
        var state = try start(options: session.options, players: session.players, seed: session.seed, sessionVersion: session.sessionVersion)
        for action in session.actions { state = try apply(action, to: state) }
        return state
    }

    public static func scores(of state: GameState) -> [String: Int] {
        guard state.mode != .relay else { return [:] }
        return Dictionary(uniqueKeysWithValues: state.playerIDs.map { ($0, state.score($0)) })
    }

    /// Player groups ordered by the mode's ranking keys, sudden death applied (section 5.5).
    public static func standings(of state: GameState) -> [[String]] {
        guard state.mode != .relay else { return [] }
        guard let sd = state.suddenDeath else { return state.mainStandings() }
        var groups = sd.winner.map { [[$0]] } ?? [sd.players]
        groups.append(contentsOf: sd.eliminated.reversed())
        groups.append(contentsOf: sd.base.dropFirst())
        return groups
    }

    /// The JSON object of section 7 with the mode's extras (JSONSerialization-compatible).
    public static func summary(of state: GameState) -> [String: Any] {
        var out: [String: Any] = [
            "phase": state.phase.rawValue,
            "round": state.round,
            "scores": scores(of: state),
            "standings": standings(of: state),
        ]
        if state.hasActivePlayer, state.phase != .finished {
            out["active"] = state.activePlayer
        }
        if let sd = state.suddenDeath, state.phase == .suddenDeath || state.phase == .suddenDeathOpen {
            out["suddenDeath"] = ["kind": sd.kind.rawValue, "players": sd.players]
        }
        if state.options.stakes { out["chips"] = state.chips }
        switch state.options {
        case .bullseye:
            out["exact"] = state.stats["exact"]
            out["distance"] = state.stats["distance"]
        case .eraSort:
            out["rightEras"] = state.stats["rightEras"]
        case let .timeline(timeline):
            if timeline.ownership == .personal {
                out["timelines"] = state.timelines.mapValues { $0.map(\.cardId) }
            } else {
                out["timeline"] = state.line.map(\.cardId)
            }
            out["tokens"] = state.stats["tokens"]
            out["wrong"] = state.stats["wrong"]
        case let .ladder(ladder):
            out["usedMs"] = state.stats["usedMs"]
            out["exactYears"] = state.stats["exactYears"]
            out["step"] = state.step
            if ladder.buzzer { out["buzzers"] = state.stats["buzzers"] }
        case let .higherLower(higherLower):
            out["streaks"] = state.stats["streaks"]
            out["eliminated"] = state.eliminated
            if let reference = state.reference { out["reference"] = reference.cardId }
            if higherLower.play == .everyone { out["lives"] = state.stats["lives"] }
        case .relay:
            out["lives"] = state.lives
            out["timeline"] = state.line.map(\.cardId)
            out["teamScore"] = state.lives * 10 + state.line.count
            out["outcome"] = state.outcome
        case .lineup:
            out["perfect"] = state.stats["perfect"]
        case let .daily(daily):
            let maximum = Scoring.dailyMaxScore(count: daily.cards.count)
            out["maxScore"] = maximum
            out["eras"] = state.dailyEras
            if state.phase == .finished, let player = state.playerIDs.first,
               let text = try? Scoring.dailyShareText(date: daily.date, score: state.score(player), maxScore: maximum, eraIds: state.dailyEras) {
                out["shareText"] = text
            }
        case .imposter:
            out["bonuses"] = state.stats["bonuses"]
        }
        return out
    }

    static func playerRange(_ mode: GameMode) -> ClosedRange<Int> {
        switch mode {
        case .bullseye, .eraSort: return 1...10
        case .timeline: return 2...8
        case .ladder: return 1...8
        case .higherLower, .lineup: return 1...6
        case .relay: return 2...10
        case .daily: return 1...1
        case .imposter: return 2...8
        }
    }

    static func validateSetup(_ options: GameOptions, _ players: [SessionPlayer], sessionVersion: Int = GameSession.version) throws {
        let range = playerRange(options.mode)
        try require(range.contains(players.count), "\(options.mode.rawValue) needs \(range.lowerBound)–\(range.upperBound) players.")
        // The session file's player rules, checked here too so in-memory callers get the same answers.
        for player in players {
            try require(DeckCodec.isIdentifier(player.id, maximumLength: 32), "Invalid player ID: \(player.id).")
            try require(DeckCodec.isVisibleText(player.name, maximum: 40), "Invalid name for player \(player.id).")
            try require(player.members.map { $0.count <= 8 && $0.allSatisfy { DeckCodec.isVisibleText($0, maximum: 40) } } ?? true,
                        "Invalid members for player \(player.id).")
        }
        try require(Set(players.map { Array($0.id.utf8) }).count == players.count, "Player IDs must be unique.")
        func anchorYear(_ kind: AnchorKind, _ year: Int?) throws {
            if kind == .custom {
                try require(year.map { (1850...2100).contains($0) } ?? false, "A custom anchor needs anchorYear 1850–2100.")
            } else {
                try require(year == nil, "anchorYear is only allowed with a custom anchor.")
            }
        }
        switch options {
        case let .bullseye(o): try require((1...100).contains(o.rounds), "rounds must be 1–100.")
        case let .eraSort(o): try require((1...100).contains(o.rounds), "rounds must be 1–100.")
        case let .timeline(o):
            try anchorYear(o.anchor, o.anchorYear)
            try require((2...30).contains(o.target), "target must be 2–30.")
            try require((0...5).contains(o.tokens), "tokens must be 0–5.")
        case let .ladder(o):
            try require((1...100).contains(o.rounds), "rounds must be 1–100.")
            let maximumStep = LadderOptions.maximumStep(version: sessionVersion)
            try require((1...5).contains(o.steps.count) && o.steps.allSatisfy { (500...maximumStep).contains($0) }
                        && zip(o.steps, o.steps.dropFirst()).allSatisfy { $0 < $1 }, "steps must be 1–5 strictly increasing values 500–\(maximumStep).")
            try require(sessionVersion != 1 || !o.buzzer, "buzzer needs session version 2.")
        case let .higherLower(o):
            try require((2...100).contains(o.cards), "cards must be 2–100.")
            try require(sessionVersion != 1 || (o.play == .turns && o.lives == nil && !o.closer), "play, lives and closer need session version 2.")
            if let lives = o.lives {
                try require(o.play == .everyone, "lives is only allowed with play: everyone.")
                try require((1...5).contains(lives), "lives must be 1–5.")
            }
        case let .relay(o):
            try anchorYear(o.anchor, o.anchorYear)
            try require((2...30).contains(o.target), "target must be 2–30.")
            try require((1...10).contains(o.lives), "lives must be 1–10.")
        case let .lineup(o):
            try require((3...5).contains(o.k), "k must be 3–5.")
            try require((1...20).contains(o.rounds), "rounds must be 1–20.")
            try require((1000...60_000).contains(o.clipMs), "clipMs must be 1000–60000.")
        case let .daily(o):
            try require(CivilDate.isValid(o.date), "date must be a real YYYY-MM-DD date.")
            try require((1...5).contains(o.cards.count) && Set(o.cards.map { Array($0.utf8) }).count == o.cards.count && o.cards.allSatisfy { DeckCodec.isIdentifier($0) },
                        "cards must be 1–5 unique card IDs.")
        case let .imposter(o): try require((1...50).contains(o.rounds), "rounds must be 1–50.")
        }
    }
}

// MARK: - Common actions, wagers, end evaluation and sudden death

extension GameState {
    mutating func handle(_ action: GameAction) throws {
        switch action {
        case let .clip(fromMs, lengthMs):
            try require(phase == .open || phase == .suddenDeathOpen, "clip needs a card in play.")
            try require(fromMs >= 0 && (lengthMs.map { $0 >= 1 } ?? true), "clip needs fromMs ≥ 0 and lengthMs ≥ 1.")
        case .skip:
            try require(phase == .open || phase == .suddenDeathOpen, "skip needs a card in play.")
            discardCardInPlay()
        case .end:
            if phase == .open || phase == .suddenDeathOpen { discardCardInPlay() }
            if phase == .suddenDeath {
                phase = .finished
            } else {
                if mode == .relay { outcome = "ended" }
                // Before the first reveal nobody has played, so there is no tie to break.
                if round == 0 { phase = .finished } else { endEvaluation() }
            }
        case .reveal:
            if phase == .suddenDeathOpen {
                try revealSuddenDeath()
            } else {
                try require(phase == .open, "reveal needs a card in play.")
                try reveal()
            }
        case let .wager(playerId, amount):
            try wager(playerId, amount)
        case let .sdDraw(cards):
            try require(phase == .suddenDeath, "sdDraw is only allowed in sudden death.")
            let sd = suddenDeath!
            let count = sd.kind == .lineup ? suddenDeathLineupSize : 1
            try require(cards.count == count, "sdDraw needs exactly \(count) card(s).")
            try enter(cards)
            suddenDeath!.cards = cards
            phase = .suddenDeathOpen
        case let .sdGuess(playerId, year):
            try suddenDeathInput(.closestYear, playerId)
            try require(suddenDeath!.guesses[playerId] == nil, "One sdGuess per player.")
            try require((1850...2100).contains(year), "year must be 1850–2100.")
            suddenDeath!.guesses[playerId] = year
        case let .sdOrder(playerId, order):
            try suddenDeathInput(.lineup, playerId)
            try require(suddenDeath!.orders[playerId] == nil, "One sdOrder per player.")
            try requirePermutation(order, of: suddenDeath!.cards)
            suddenDeath!.orders[playerId] = order
        case let .sdName(playerId):
            try require(phase == .suddenDeathOpen && suddenDeath?.kind == .firstToName, "sdName is not allowed now.")
            try require(!suddenDeath!.nameGiven, "One sdName per sudden-death card.")
            if let playerId { try checkPlayer(playerId); try require(suddenDeath!.players.contains(playerId), "\(playerId) is not in sudden death.") }
            suddenDeath!.nameGiven = true
            suddenDeath!.named = playerId
        default:
            try handleModeAction(action)
        }
    }

    var suddenDeathKind: SuddenDeathKind? {
        switch mode {
        case .bullseye, .eraSort: return .closestYear
        case .timeline, .lineup: return .lineup
        case .ladder: return .firstToName
        default: return nil
        }
    }

    var suddenDeathLineupSize: Int {
        if case let .lineup(lineup) = options { return lineup.k }
        return 4
    }

    func checkPlayer(_ id: String) throws {
        try require(exactPlayerID(id) != nil, "Unknown player: \(id).")
    }

    /// The session player spelled exactly like `id`. Exact scalars: `String ==` would treat
    /// canonically equivalent IDs as equal. Player IDs are ASCII (checked at setup), so once an
    /// ID has passed this check, dictionary lookups keyed by player ID are exact as well.
    func exactPlayerID(_ id: String) -> String? {
        playerIDs.first { $0.utf8.elementsEqual(id.utf8) }
    }

    func checkCard(_ card: CardRef) throws {
        try require(DeckCodec.isIdentifier(card.cardId), "Invalid card ID: \(card.cardId).")
        try require((1850...2100).contains(card.year), "Card year must be 1850–2100.")
        try require(card.era == EraBoundaries.eraOf(card.year), "Card era must be eraOf(year).")
    }

    /// Cards enter a session at most once (section 5.1).
    mutating func enter(_ cards: [CardRef]) throws {
        for card in cards {
            try checkCard(card)
            try require(used.insert(Array(card.cardId.utf8)).inserted, "Card \(card.cardId) is already in the session.")
        }
    }

    func requirePermutation(_ order: [String], of cards: [CardRef]) throws {
        let given = order.map { Array($0.utf8) }.sorted { $0.lexicographicallyPrecedes($1) }
        let drawn = cards.map { Array($0.cardId.utf8) }.sorted { $0.lexicographicallyPrecedes($1) }
        try require(given == drawn, "order must be a permutation of the drawn cards.")
    }

    private mutating func suddenDeathInput(_ kind: SuddenDeathKind, _ playerId: String) throws {
        try require(phase == .suddenDeathOpen && suddenDeath?.kind == kind, "This sudden-death input is not allowed now.")
        try checkPlayer(playerId)
        try require(suddenDeath!.players.contains(playerId), "\(playerId) is not in sudden death.")
    }

    /// `skip`: the card in play is discarded unscored and every input for it is undone.
    mutating func discardCardInPlay() {
        if phase == .suddenDeathOpen {
            suddenDeath!.clearRound()
            phase = .suddenDeath
            return
        }
        for challenge in inputs.challenges { bump("tokens", challenge.player) }
        clearCard()
    }

    /// Ends the card in play and waits for the next draw.
    mutating func clearCard() {
        inputs = CardInputs()
        card = nil
        cardSet = []
        pair = nil
        step = -1
        phase = .awaitingDraw
    }

    /// Who must wager before the reveal: everyone in Ladder and Bullseye, the active player in Timeline.
    func mustWager(_ player: String) -> Bool {
        mode == .timeline ? player == activePlayer : true
    }

    private mutating func wager(_ playerId: String, _ amount: Int) throws {
        try require(options.stakes, "Stakes are off.")
        try require(phase == .open, "wager needs a card in play.")
        try checkPlayer(playerId)
        try require(mustWager(playerId), "\(playerId) may not wager.")
        if mode == .timeline { try require(inputs.placement != nil, "wager follows place.") }
        try require(inputs.wagers[playerId] == nil, "One wager per player per card.")
        let held = chips[playerId] ?? 0
        try require(held >= 1, "\(playerId) holds no chips.")
        try require((1...min(3, held)).contains(amount), "chips must be 1–\(min(3, held)).")
        inputs.wagers[playerId] = amount
    }

    func requireWagers() throws {
        guard options.stakes else { return }
        for player in playerIDs where mustWager(player) && (chips[player] ?? 0) >= 1 {
            try require(inputs.wagers[player] != nil, "reveal needs a wager from \(player).")
        }
    }

    mutating func settleWager(_ player: String, right: Bool) {
        guard let amount = inputs.wagers[player] else { return }
        chips[player, default: 0] += right ? amount : -amount
    }

    /// Section 5.5: sudden death when the mode has one and the first group is shared.
    mutating func endEvaluation() {
        let groups = mainStandings()
        if let kind = suddenDeathKind, let first = groups.first, first.count > 1 {
            suddenDeath = SuddenDeathState(kind: kind, players: first, base: groups)
            phase = .suddenDeath
        } else {
            phase = .finished
        }
    }

    private mutating func revealSuddenDeath() throws {
        var sd = suddenDeath!
        let best: [String]
        switch sd.kind {
        case .closestYear:
            try require(sd.players.allSatisfy { sd.guesses[$0] != nil }, "reveal needs every sdGuess.")
            let year = sd.cards[0].year
            let closest = sd.players.map { abs(sd.guesses[$0]! - year) }.min()!
            best = sd.players.filter { abs(sd.guesses[$0]! - year) == closest }
        case .lineup:
            try require(sd.players.allSatisfy { sd.orders[$0] != nil }, "reveal needs every sdOrder.")
            let years = Dictionary(uniqueKeysWithValues: sd.cards.map { ($0.cardId, $0.year) })
            let points = try Dictionary(uniqueKeysWithValues: sd.players.map { ($0, try Scoring.lineupPoints(order: sd.orders[$0]!, years: years)) })
            let top = points.values.max()!
            best = sd.players.filter { points[$0] == top }
        case .firstToName:
            try require(sd.nameGiven, "reveal needs an sdName.")
            best = sd.named.map { [$0] } ?? sd.players
        }
        let out = sd.players.filter { !best.contains($0) }
        if !out.isEmpty { sd.eliminated.append(out) }
        sd.clearRound()
        if best.count == 1 {
            sd.winner = best[0]
            sd.players = best
            phase = .finished
        } else {
            sd.players = best
            phase = .suddenDeath
        }
        suddenDeath = sd
    }

    /// Ranking keys per mode, compared ascending (descending keys are negated).
    func rankingKey(_ player: String) -> [Int] {
        let score = self.score(player)
        switch mode {
        case .bullseye: return [-score, -stat("exact", player), stat("distance", player)]
        case .eraSort: return [-score, -stat("rightEras", player)]
        case .timeline: return [-score, stat("wrong", player)]
        case .ladder: return [-score, stat("usedMs", player), -stat("exactYears", player)]
        case .higherLower:
            // Eliminated players by the reveal that eliminated them, later first; lives count only with everyone (0 otherwise).
            if let round = eliminatedRound[player] { return [1, -round, -stat("streaks", player)] }
            return [0, -stat("streaks", player), -stat("lives", player)]
        case .lineup: return [-score, -stat("perfect", player)]
        case .imposter: return [-score, -stat("bonuses", player)]
        case .daily: return [-score]
        case .relay: return []
        }
    }

    /// Groups of equal keys in key order; each group in turn order.
    func mainStandings() -> [[String]] {
        guard mode != .relay else { return [] }
        let keyed = playerIDs.map { ($0, rankingKey($0)) }
        let ordered = keyed.enumerated().sorted { lhs, rhs in
            lhs.element.1 != rhs.element.1 ? lhs.element.1.lexicographicallyPrecedes(rhs.element.1) : lhs.offset < rhs.offset
        }.map(\.element)
        var groups = [[String]]()
        var lastKey: [Int]?
        for (player, key) in ordered {
            if key == lastKey { groups[groups.count - 1].append(player) } else { groups.append([player]) }
            lastKey = key
        }
        return groups
    }
}
