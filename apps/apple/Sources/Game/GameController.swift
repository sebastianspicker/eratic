import SwiftUI
import EraticCore

/// Where the host's cards come from.
enum CardSource: String, CaseIterable, Identifiable {
    case scan, draw
    var id: String { rawValue }
    var label: String { self == .scan ? "Scan printed cards" : "Draw from deck" }
}

/// What a scanned payload means for the game in progress.
enum ScanOutcome: Equatable {
    case draw(SongCard)
    case message(String)
    /// A provider link that isn't in the deck: it may play, but it is never scored.
    case audioOnly(ProviderTrack, payload: String)
}

/// The states just before and after a reveal, for the reveal screen.
struct RevealSnapshot {
    let before: GameState
    let after: GameState
}

/// The Daily Eratic record in `UserDefaults` (`eratic.daily.v1`).
struct DailyRecord: Codable, Equatable {
    var lastDate: String
    var streak: Int
    var lastScore: Int
    var deckId: String
    var shareText: String?
}

/// Runs one session: every action goes through `GameEngine.apply`, is appended to the session and saved.
@MainActor
final class GameController: ObservableObject {
    static let dailyKey = "eratic.daily.v1"
    private static let easyOnlyKey = "eratic.play.easyOnlySession.v1"
    private static let kidsKey = "eratic.play.kidsSession.v1"
    /// The ID of the saved session whose reveal or results the host hasn't seen yet (a new key, no migration).
    private static let unseenKey = "eratic.play.unseen.v1"

    @Published private(set) var session: GameSession?
    @Published private(set) var state: GameState?
    @Published var lastError: String?
    /// The personal-best outcome recorded for a finished session, so the results can show it again.
    var bestOutcome: (sessionId: String, outcome: Bests.Outcome)?
    /// Snippet Ladder's answer is shown, or a step is preparing, starting or playing: Undo is hidden.
    @Published var ladderBusy = false
    @Published private(set) var lastReveal: RevealSnapshot?
    /// The reveal screen is up; *Next card* clears it.
    @Published var showingReveal = false
    /// The host screen is up (a game was started or resumed).
    @Published var isHosting = false
    /// Setup news for the host to read out, such as Timeline anchors.
    @Published var announcement: String?
    /// Set when a saved game couldn't be read and was kept aside.
    @Published private(set) var storeNotice: String?
    @Published var cardSource = CardSource.draw
    @Published private(set) var easyOnly = false
    /// Timeline's Kids switch: larger controls for this session (the options themselves were preset at setup).
    @Published private(set) var kids = false
    @Published private(set) var daily: DailyRecord?
    /// The deck copy saved with the session, used to resume when another deck (or none) is loaded.
    @Published private(set) var snapshotDeck: Deck?
    /// Actions waiting for the clip to become audible (a `clip` record, Snippet Ladder's `step` first);
    /// the host screen dispatches them then and drops them if the clip stops or fails first.
    var pendingClipRecords: [GameAction] = []
    /// The game finished and its results weren't shown yet, so Play home offers to go back to them.
    @Published private(set) var unseenResults = false
    /// Said once per session when a loaded deck with the session's ID differs from the copy the game started with.
    @Published var deckNotice: String?
    private var deckNoticeSession: String?

    private let store: SessionStore
    private let defaults: UserDefaults

    init(store: SessionStore = SessionStore(), defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.dailyKey) { daily = try? JSONDecoder().decode(DailyRecord.self, from: data) }
        switch store.load() {
        case .none: break
        case let .session(saved):
            do {
                state = try GameEngine.replay(saved)
                session = saved
                easyOnly = defaults.string(forKey: Self.easyOnlyKey) == saved.id
                kids = defaults.string(forKey: Self.kidsKey) == saved.id
                loadSnapshot(for: saved)
                restoreUnseen(for: saved)
            } catch {
                // Kept aside like an unreadable file, so the next game doesn't overwrite it.
                let reason = Self.message(error)
                if let name = store.quarantineCurrent() {
                    storeNotice = "Your saved game couldn't be replayed (\(reason)). It was kept as \(name) in Eratic's Sessions folder."
                } else {
                    storeNotice = "Your saved game couldn't be replayed (\(reason)) or moved aside, so Eratic won't overwrite it."
                }
            }
        case let .quarantined(fileName, reason):
            storeNotice = "Your saved game couldn't be read (\(reason)). It was kept as \(fileName) in Eratic's Sessions folder."
        }
    }

    /// An unfinished saved game the home screen offers to resume.
    var resumable: Bool { state.map { $0.phase != .finished } ?? false }

    /// Play home offers *Resume*: an unfinished game, or finished results not seen yet.
    var canReturn: Bool { session != nil && (resumable || unseenResults) }

    /// The deck the session plays: the copy saved when it started, otherwise the loaded deck when its ID matches.
    /// A game always plays against the deck it started with.
    func deck(loaded: Deck?) -> Deck? {
        guard let session else { return nil }
        if let snapshotDeck, snapshotDeck.id == session.deckId { return snapshotDeck }
        if let loaded, loaded.id == session.deckId { return loaded }
        return nil
    }

    /// Sets `deckNotice` once per session when the loaded deck has the session's ID but differs from its copy.
    func noteDeckDifference(loaded: Deck?) {
        guard let session, deckNoticeSession != session.id, let snapshotDeck, let loaded,
              snapshotDeck.id == session.deckId, loaded.id == session.deckId, loaded != snapshotDeck else { return }
        deckNoticeSession = session.id
        deckNotice = "Playing with the deck as it was when this game started."
    }

    /// True when the unfinished saved game is today's Daily Eratic for this deck, which resumes rather than restarts.
    func unfinishedDailyToday(deck: Deck) -> Bool {
        guard resumable, let session, case let .daily(options) = session.options else { return false }
        return options.date == Self.todayUTC() && session.deckId == deck.id
    }

    func resultsSeen() {
        unseenResults = false
        syncUnseenMarker()
    }

    /// *Next card* / *See results*: the reveal was acknowledged.
    func dismissReveal() {
        showingReveal = false
        syncUnseenMarker()
    }

    /// Persists whether the saved session still has a reveal or results the host hasn't seen.
    private func syncUnseenMarker() {
        if let session, showingReveal || unseenResults {
            defaults.set(session.id, forKey: Self.unseenKey)
        } else {
            defaults.removeObject(forKey: Self.unseenKey)
        }
    }

    /// Brings back an unseen reveal (replayed to the last `reveal` action) and unseen results after a relaunch.
    private func restoreUnseen(for saved: GameSession) {
        guard defaults.string(forKey: Self.unseenKey) == saved.id, let current = state else { return }
        var replayed = try? GameEngine.start(options: saved.options, players: saved.players, seed: saved.seed, sessionVersion: saved.sessionVersion)
        var snapshot: RevealSnapshot?
        for entry in saved.actions {
            guard let before = replayed, let after = try? GameEngine.apply(entry, to: before) else { break }
            if case .reveal = entry.action { snapshot = RevealSnapshot(before: before, after: after) }
            replayed = after
        }
        unseenResults = current.phase == .finished
        // Only a reveal that was the last thing to happen; a game ended by End game goes straight to results.
        var lastIsReveal = false
        if let last = saved.actions.last(where: { if case .clip = $0.action { return false }; return true }), case .reveal = last.action { lastIsReveal = true }
        if let snapshot, lastIsReveal {
            lastReveal = snapshot
            showingReveal = true
        }
        syncUnseenMarker()
    }

    private func loadSnapshot(for session: GameSession) {
        switch store.loadDeck() {
        case .none: snapshotDeck = nil
        case let .deck(deck): snapshotDeck = deck.id == session.deckId ? deck : nil
        case let .quarantined(fileName, reason):
            snapshotDeck = nil
            storeNotice = "The saved copy of the game's deck couldn't be read (\(reason)). It was kept as \(fileName) in Eratic's Sessions folder; load the deck to resume."
        }
    }

    // MARK: Starting and leaving

    func start(options: GameOptions, players: [SessionPlayer], deck: Deck, cardSource: CardSource, easyOnly: Bool = false, kids: Bool = false) {
        let now = Date()
        let millis = Int(now.timeIntervalSince1970 * 1000)
        // Daily Eratic plays the day's selection from the whole deck, whatever "Easy cards only" says.
        let easyOnly = easyOnly && options.mode != .daily
        var created = GameSession(id: "s-" + String(millis, radix: 36), createdAt: Self.timestamp(now), deckId: deck.id, deckTitle: deck.title,
                                  options: options, seed: UInt32.random(in: .min ... .max), players: players)
        do {
            var next = try GameEngine.start(options: options, players: players, seed: created.seed)
            let pool = Self.drawPool(deck, easyOnly: easyOnly)
            let needed = cardsNeeded(options, players: players.count)
            guard pool.count >= needed else {
                throw DeckError("This game needs at least \(needed) cards" + (easyOnly ? " with difficulty 1 or 2" : "") + "; the deck has \(pool.count).")
            }
            if options.mode == .imposter, try GameRandom.imposterPairs(pool.map { (id: $0.id, relatedTo: $0.relatedTo) }, seed: 0).isEmpty {
                throw DeckError("Original or Imposter needs linked recordings" + (easyOnly ? " among the easy cards." : "."))
            }
            // Setup cards are picked before anything is saved, so a deck that is too small never leaves a half-started game.
            let setup = try setupActions(created, pool: pool)
            for action in setup.actions {
                let entry = SessionAction(at: 0, action)
                next = try GameEngine.apply(entry, to: next)
                created.actions.append(entry)
            }
            _ = try SessionCodec.encode(created)
            session = created
            state = next
            self.cardSource = cardSource
            self.easyOnly = easyOnly
            self.kids = kids
            defaults.set(easyOnly ? created.id : nil, forKey: Self.easyOnlyKey)
            defaults.set(kids ? created.id : nil, forKey: Self.kidsKey)
            lastReveal = nil
            showingReveal = false
            unseenResults = false
            syncUnseenMarker()
            deckNotice = nil
            pendingClipRecords = []
            announcement = setup.announcement
            lastError = nil
            persist()
            snapshotDeck = deck
            do {
                try store.saveDeck(deck)
            } catch {
                // Keep an earlier save error: both matter.
                let message = "The deck copy couldn't be saved, so resuming will need the deck loaded: \(Self.message(error))"
                lastError = [lastError, message].compactMap { $0 }.joined(separator: "\n")
            }
            isHosting = true
        } catch {
            lastError = Self.message(error)
        }
    }

    /// Timeline and Relay anchors (`pickAnchors`) and the Higher or Lower reference (first card of `drawOrder`), with the announcement.
    private func setupActions(_ session: GameSession, pool: [SongCard]) throws -> (actions: [GameAction], announcement: String?) {
        func anchors(_ kind: AnchorKind, _ year: Int?, count: Int) throws -> [SongCard] {
            let ids = try GameRandom.pickAnchors(pool.map { AnchorCandidate(id: $0.id, year: $0.gameYear.value) }, kind: kind, seed: session.seed, count: count, year: year)
            return ids.compactMap { id in pool.first { $0.id == id } }
        }
        switch session.options {
        case let .timeline(timeline):
            if timeline.ownership == .personal {
                let picks = try anchors(timeline.anchor, timeline.anchorYear, count: session.players.count)
                let pairs = Array(zip(session.players, picks))
                return (pairs.map { .anchor(playerId: $0.0.id, card: cardRef(for: $0.1)) },
                        pairs.map { "Give \($0.0.name) “\($0.1.title)” (\($0.1.gameYear.value)) as their first card." }.joined(separator: "\n"))
            }
            guard let card = try anchors(timeline.anchor, timeline.anchorYear, count: 1).first else { return ([], nil) }
            return ([.anchor(playerId: nil, card: cardRef(for: card))], "Start the shared line with “\(card.title)” (\(card.gameYear.value)).")
        case let .relay(relay):
            guard let card = try anchors(relay.anchor, relay.anchorYear, count: 1).first else { return ([], nil) }
            return ([.anchor(playerId: nil, card: cardRef(for: card))], "Start the team's line with “\(card.title)” (\(card.gameYear.value)).")
        case .higherLower:
            guard let id = GameRandom.drawOrder(pool.map(\.id), seed: session.seed).first, let card = pool.first(where: { $0.id == id }) else {
                throw DeckError("The deck has no card left for the reference.")
            }
            return ([.reference(card: cardRef(for: card))], nil)
        default:
            return ([], nil)
        }
    }

    /// The same players and options, a new seed.
    func playAgain(deck: Deck) {
        guard let session else { return }
        start(options: session.options, players: session.players, deck: deck, cardSource: cardSource, easyOnly: easyOnly, kids: kids)
    }

    /// Back to the host screen; a reveal that wasn't acknowledged with *Next card* is shown again.
    func resume() {
        isHosting = true
    }

    /// Back to Play home; the session stays saved, and an unacknowledged reveal stays up for *Resume*.
    func leave() {
        isHosting = false
        announcement = nil
        lastError = nil
        pendingClipRecords = []
    }

    /// Removes the saved game, then its deck copy. The UI confirms first.
    func discard() {
        do {
            try store.discardSession()
        } catch {
            lastError = Self.message(error)
            return
        }
        session = nil
        state = nil
        snapshotDeck = nil
        lastReveal = nil
        showingReveal = false
        unseenResults = false
        defaults.removeObject(forKey: Self.unseenKey)
        deckNotice = nil
        pendingClipRecords = []
        isHosting = false
        do {
            try store.discardDeck()
        } catch {
            lastError = "The saved game was discarded, but its deck copy couldn't be removed: \(Self.message(error))"
        }
    }

    // MARK: Actions

    /// Stamps, applies, appends and saves one action. A rejected action leaves everything unchanged.
    @discardableResult
    func dispatch(_ action: GameAction) -> Bool {
        guard var session, let state else { return false }
        let entry = SessionAction(at: max(session.actions.last?.at ?? 0, elapsedMs(since: session.createdAt)), action)
        do {
            let next = try GameEngine.apply(entry, to: state)
            session.actions.append(entry)
            self.session = session
            self.state = next
            lastError = nil
            if case .reveal = action {
                lastReveal = RevealSnapshot(before: state, after: next)
                showingReveal = true
            }
            persist()
            if next.phase == .finished, state.phase != .finished {
                unseenResults = true
                finished(session, next)
            }
            syncUnseenMarker()
            return true
        } catch {
            lastError = Self.message(error)
            return false
        }
    }

    // MARK: Undo

    /// The player and the action indices an undo removes, or nil when the last non-clip action isn't an entry.
    /// Trailing `clip` records stay; so do interleaved ones. A guess takes the same player's wager
    /// directly before it along (Bullseye sends both as one entry); nothing else is grouped.
    /// Steps, marks, draws, reveals, skips, ends, anchors and references are never undone.
    static func undoSelection(_ actions: [SessionAction]) -> (playerID: String?, indices: [Int])? {
        /// The entry's player (nil inside the outer optional means "not an entry").
        func entryPlayer(_ action: GameAction) -> String?? {
            switch action {
            case let .guess(player, _), let .pickEra(player, _), let .place(player, _), let .challenge(player, _),
                 let .nameIt(player, _, _), let .wager(player, _), let .lock(player, _), let .call(player, _),
                 let .order(player, _), let .choose(player, _, _), let .sdGuess(player, _), let .sdOrder(player, _):
                return .some(player)
            case let .sdName(player):
                return .some(player)
            default:
                return .none
            }
        }
        func isClip(_ action: GameAction) -> Bool {
            if case .clip = action { return true }
            return false
        }
        guard let last = actions.lastIndex(where: { !isClip($0.action) }), let player = entryPlayer(actions[last].action) else { return nil }
        var indices = [last]
        // A guess takes the same player's wager directly before it along (Bullseye sends wager then guess as one entry).
        var lastIsGuess = false
        if case .guess = actions[last].action { lastIsGuess = true }
        if let player, lastIsGuess,
           let previous = actions[..<last].lastIndex(where: { !isClip($0.action) }),
           case let .wager(owner, _) = actions[previous].action, owner == player {
            indices.append(previous)
        }
        return (player, indices.sorted())
    }

    /// What *Undo* would take back before the reveal: the player (nil for “Nobody named it”) and a button label.
    var undoable: (playerID: String?, label: String)? {
        guard let session, let state, state.phase == .open || state.phase == .suddenDeathOpen,
              let selection = Self.undoSelection(session.actions) else { return nil }
        guard let playerID = selection.playerID else { return (nil, "Undo “Nobody named it”") }
        return (playerID, "Undo \(session.playerName(playerID))'s entry")
    }

    /// Takes back the last entry (see `undoSelection`) by replaying the shortened session. Only while a card is open.
    @discardableResult
    func undo() -> Bool {
        guard var session, let state, state.phase == .open || state.phase == .suddenDeathOpen,
              let selection = Self.undoSelection(session.actions) else { return false }
        let removed = Set(selection.indices)
        session.actions = session.actions.enumerated().filter { !removed.contains($0.offset) }.map(\.element)
        do {
            let next = try GameEngine.replay(session)
            self.session = session
            self.state = next
            lastError = nil
            persist()
            return true
        } catch {
            lastError = Self.message(error)
            return false
        }
    }

    /// What is in play: phase, round and card IDs. A clip prepared under one key is dropped once it changes.
    var playKey: String? {
        guard let state else { return nil }
        let ids = state.currentCard.map { [$0.cardId] } ?? (state.currentPair.map { [$0.a.cardId, $0.b.cardId] } ?? state.currentSet.map(\.cardId))
        let sd = state.suddenDeathInfo?.cards.map(\.cardId) ?? []
        return "\(state.phase.rawValue):\(state.round):" + (ids + sd).joined(separator: ",")
    }

    func cardRef(for card: SongCard) -> CardRef {
        CardRef(cardId: card.id, year: card.gameYear.value)
    }

    /// The next `count` unused cards in draw order (Daily: the day's next card), or nil when the deck runs out.
    func nextDeckCards(_ count: Int, in deck: Deck) -> [SongCard]? {
        guard let session, let state else { return nil }
        if case let .daily(daily) = session.options {
            // A skipped Daily card can't be replaced, so the round's card already used means nothing is left to draw.
            guard state.round < daily.cards.count, let card = deck.cards.first(where: { $0.id == daily.cards[state.round] }),
                  !state.usedCardIDs.contains(card.id) else { return nil }
            return [card]
        }
        if case let .higherLower(higherLower) = session.options, higherLower.closer, count == 1, let reference = state.referenceCard {
            // Closer years (game-rules.md 1.5): the unused cards in draw order, the pick nearest the reference year first.
            let pool = drawPool(deck)
            let byID = Dictionary(pool.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let candidates = GameRandom.drawOrder(pool.map(\.id), seed: session.seed).filter { !state.usedCardIDs.contains($0) }.compactMap { id in
                byID[id].map { AnchorCandidate(id: $0.id, year: $0.gameYear.value) }
            }
            guard let id = GameRandom.closerPick(candidates, referenceYear: reference.year, revealed: state.round),
                  let card = deck.cards.first(where: { $0.id == id }) else { return nil }
            return [card]
        }
        let ids = GameRandom.drawOrder(drawPool(deck).map(\.id), seed: session.seed).filter { !state.usedCardIDs.contains($0) }.prefix(count)
        let cards = ids.compactMap { id in deck.cards.first { $0.id == id } }
        return cards.count == count ? cards : nil
    }

    func nextDeckCard(in deck: Deck) -> SongCard? { nextDeckCards(1, in: deck)?.first }

    /// The number of cards the next draw needs, or nil when nothing can be drawn now. Original or Imposter draws pairs instead.
    var drawCount: Int? {
        guard let state else { return nil }
        switch state.phase {
        case .awaitingDraw:
            if case let .lineup(lineup) = state.options { return lineup.k }
            return state.mode == .imposter ? nil : 1
        case .suddenDeath:
            return state.suddenDeathInfo?.cardCount
        default:
            return nil
        }
    }

    /// True when the next draw (cards or a pair) has something left in the deck.
    func canDraw(in deck: Deck) -> Bool {
        if state?.mode == .imposter, state?.phase == .awaitingDraw { return nextPair(in: deck) != nil }
        guard let count = drawCount else { return false }
        return nextDeckCards(count, in: deck) != nil
    }

    /// The next pair of `imposterPairs` that wasn't paired in this session yet.
    func nextPair(in deck: Deck) -> (a: SongCard, b: SongCard, original: PairSide)? {
        guard let session, let state else { return nil }
        let pool = drawPool(deck)
        // A valid deck has unique card IDs, so the pairs can't fail here.
        for pair in (try? GameRandom.imposterPairs(pool.map { (id: $0.id, relatedTo: $0.relatedTo) }, seed: session.seed)) ?? [] where !state.wasPaired(pair.a, pair.b) {
            guard let a = pool.first(where: { $0.id == pair.a }), let b = pool.first(where: { $0.id == pair.b }) else { continue }
            return (a, b, pair.original == pair.a ? .a : .b)
        }
        return nil
    }

    /// Draws from the deck for the current phase. Returns false when the deck has run out.
    @discardableResult
    func drawFromDeck(_ deck: Deck) -> Bool {
        if state?.mode == .imposter, state?.phase == .awaitingDraw {
            guard let pair = nextPair(in: deck) else { return false }
            return dispatch(.drawPair(a: cardRef(for: pair.a), b: cardRef(for: pair.b), original: pair.original))
        }
        guard let count = drawCount, let cards = nextDeckCards(count, in: deck) else { return false }
        return play(cards)
    }

    /// Puts scanned or drawn cards into play with the action the phase needs.
    @discardableResult
    func play(_ cards: [SongCard]) -> Bool {
        guard let state else { return false }
        let refs = cards.map(cardRef(for:))
        switch state.phase {
        case .suddenDeath: return dispatch(.sdDraw(cards: refs))
        case .awaitingDraw where state.mode == .lineup: return dispatch(.drawSet(cards: refs))
        case .awaitingDraw where refs.count == 1: return dispatch(.draw(card: refs[0]))
        default:
            lastError = "A card can't be put into play now."
            return false
        }
    }

    /// Turns a scanned payload into a card to play or a message for the host.
    func resolveScan(_ payload: String, deck: Deck) -> ScanOutcome {
        switch ScanRules.resolveScan(payload: payload, deck: deck, hosts: AppConfig.eraticCardHosts) {
        case let .card(cardId, _):
            guard let card = deck.cards.first(where: { $0.id == cardId }) else { return .message("Card \(cardId) isn't in \(deck.title).") }
            if state?.usedCardIDs.contains(cardId) == true { return .message("“\(card.title)” was already played in this game. Scan another card.") }
            return .draw(card)
        case let .unknownCard(cardId):
            return .message("Card \(cardId) isn't in \(deck.title).")
        case let .otherDeck(deckId):
            return .message("This card belongs to deck \(deckId). Load that deck first.")
        case let .unmatchedProvider(provider, trackId):
            return .audioOnly(ProviderTrack(provider: provider, id: trackId), payload: payload)
        case .unmatchedOfficial:
            return .message("This official card isn't linked to any card in \(deck.title).")
        case .unrecognized:
            return .message("This QR code isn't an Eratic card or a song link.")
        }
    }

    // MARK: Daily Eratic

    static func todayUTC(_ now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    /// Today's record for this deck, when today was already played.
    func dailyPlayedToday(deck: Deck) -> DailyRecord? {
        guard let daily, daily.lastDate == Self.todayUTC(), daily.deckId == deck.id else { return nil }
        return daily
    }

    /// The streak as of today: kept when the last game was today or yesterday, otherwise 0.
    var currentDailyStreak: Int {
        guard let daily else { return 0 }
        let today = Self.todayUTC()
        guard daily.lastDate == today || (try? Scoring.previousDay(today)) == daily.lastDate else { return 0 }
        return daily.streak
    }

    /// Starts today's Daily Eratic, unless it was already played (then the home screen shows the result).
    /// An unfinished Daily for today resumes instead; the UI asks before another unfinished game is replaced.
    func startDaily(deck: Deck) {
        guard dailyPlayedToday(deck: deck) == nil else { return }
        if unfinishedDailyToday(deck: deck) {
            resume()
            return
        }
        let date = Self.todayUTC()
        let cards = GameRandom.dailySelection(deck.cards.map(\.id), date: date, deckId: deck.id)
        start(options: .daily(DailyOptions(date: date, cards: cards)), players: [SessionPlayer(id: "p1", name: "You")], deck: deck, cardSource: .draw)
    }

    private func finished(_ session: GameSession, _ state: GameState) {
        guard case let .daily(options) = session.options, let player = session.players.first else { return }
        let previous = daily.map { DailyStreakRecord(lastDate: $0.lastDate, streak: $0.streak) }
        guard let streak = try? Scoring.dailyStreak(previous: previous, date: options.date) else { return }
        let record = DailyRecord(lastDate: options.date, streak: streak, lastScore: GameEngine.scores(of: state)[player.id] ?? 0,
                                 deckId: session.deckId, shareText: GameEngine.summary(of: state)["shareText"] as? String)
        daily = record
        if let data = try? JSONEncoder().encode(record) { defaults.set(data, forKey: Self.dailyKey) }
    }

    // MARK: Helpers

    /// "Easy cards only" draws from cards with difficulty 1–2.
    private func drawPool(_ deck: Deck) -> [SongCard] { Self.drawPool(deck, easyOnly: easyOnly) }

    private static func drawPool(_ deck: Deck, easyOnly: Bool) -> [SongCard] {
        easyOnly ? deck.cards.filter { ($0.difficulty ?? 0) >= 1 && ($0.difficulty ?? 0) <= 2 } : deck.cards
    }

    private func persist() {
        guard let session else { return }
        do {
            try store.save(session)
        } catch {
            lastError = "The game couldn't be saved: \(Self.message(error))"
        }
    }

    private func elapsedMs(since createdAt: String) -> Int {
        guard let created = ISO8601DateFormatter().date(from: createdAt) else { return 0 }
        return max(0, Int(Date().timeIntervalSince(created) * 1000))
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func message(_ error: Error) -> String {
        (error as? GameError)?.message ?? error.localizedDescription
    }
}
