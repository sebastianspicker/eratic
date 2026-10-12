import XCTest
@testable import EraticCore

/// The public read-only surface the host screens use, on short engine-driven games.
final class GameQueriesTests: XCTestCase {
    private func card(_ id: String, _ year: Int) -> CardRef { CardRef(cardId: id, year: year) }

    private func players(_ count: Int) -> [SessionPlayer] {
        (1...count).map { SessionPlayer(id: "p\($0)", name: "Player \($0)") }
    }

    private func play(_ options: GameOptions, players count: Int, _ actions: [GameAction]) throws -> GameState {
        var state = try GameEngine.start(options: options, players: players(count), seed: 7)
        for (index, action) in actions.enumerated() { state = try GameEngine.apply(SessionAction(at: index * 1000, action), to: state) }
        return state
    }

    func testBullseyeInputsPendingAndReveal() throws {
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1, stakes: true))
        var state = try play(options, players: 2, [.draw(card: card("c1", 1984))])
        XCTAssertEqual(state.currentCard, card("c1", 1984))
        XCTAssertEqual(state.usedCardIDs, ["c1"])
        XCTAssertNil(state.activePlayerID)
        XCTAssertEqual(state.pendingInputs, ["p1", "p2"])
        XCTAssertFalse(state.canReveal)
        XCTAssertEqual(state.chips(for: "p1"), 5)
        XCTAssertNil(state.tokens(for: "p1"))

        state = try play(options, players: 2, [.draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1980), .guess(playerId: "p2", year: 1990)])
        XCTAssertEqual(state.guesses, ["p1": 1980, "p2": 1990])
        // Guesses are in, but stakes still need a wager from everyone holding chips.
        XCTAssertEqual(state.pendingInputs, ["p1", "p2"])
        XCTAssertTrue(state.owesWager("p1"))
        XCTAssertFalse(state.canReveal)

        state = try GameEngine.apply(SessionAction(at: 5000, .wager(playerId: "p1", chips: 2)), to: state)
        state = try GameEngine.apply(SessionAction(at: 6000, .wager(playerId: "p2", chips: 1)), to: state)
        XCTAssertEqual(state.wagers, ["p1": 2, "p2": 1])
        XCTAssertEqual(state.pendingInputs, [])
        XCTAssertTrue(state.canReveal)

        state = try GameEngine.apply(SessionAction(at: 7000, .reveal), to: state)
        XCTAssertNil(state.currentCard)
        XCTAssertFalse(state.canReveal)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertEqual(state.chips(for: "p2"), 4)
    }

    func testEraSortPicksAndSuddenDeath() throws {
        let options = GameOptions.eraSort(EraSortOptions(rounds: 1))
        var state = try play(options, players: 2, [.draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "neon")])
        XCTAssertEqual(state.picks, ["p1": "neon"])
        XCTAssertEqual(state.pendingInputs, ["p2"])
        XCTAssertNil(state.chips(for: "p1"))
        XCTAssertNil(state.suddenDeathInfo)

        state = try play(options, players: 2, [.draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "neon"), .pickEra(playerId: "p2", era: "neon"), .reveal])
        XCTAssertEqual(state.phase, .suddenDeath)
        XCTAssertEqual(state.suddenDeathInfo?.kind, .closestYear)
        XCTAssertEqual(state.suddenDeathInfo?.players, ["p1", "p2"])
        XCTAssertEqual(state.suddenDeathInfo?.cardCount, 1)
        XCTAssertEqual(state.pendingInputs, [])

        state = try GameEngine.apply(SessionAction(at: 5000, .sdDraw(cards: [card("c2", 1990)])), to: state)
        XCTAssertEqual(state.suddenDeathInfo?.cards, [card("c2", 1990)])
        XCTAssertEqual(state.pendingInputs, ["p1", "p2"])
        state = try GameEngine.apply(SessionAction(at: 6000, .sdGuess(playerId: "p2", year: 1991)), to: state)
        XCTAssertEqual(state.suddenDeathInfo?.guesses, ["p2": 1991])
        XCTAssertEqual(state.pendingInputs, ["p1"])
        XCTAssertFalse(state.canReveal)
        state = try GameEngine.apply(SessionAction(at: 7000, .sdGuess(playerId: "p1", year: 1980)), to: state)
        XCTAssertTrue(state.canReveal)
        state = try GameEngine.apply(SessionAction(at: 8000, .reveal), to: state)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertEqual(state.suddenDeathInfo?.winner, "p2")
    }

    func testHigherLowerReferenceActiveAndEliminated() throws {
        let options = GameOptions.higherLower(HigherLowerOptions(cards: 5))
        var state = try play(options, players: 3, [.reference(card: card("r", 1990)), .draw(card: card("c1", 1980))])
        XCTAssertEqual(state.referenceCard, card("r", 1990))
        XCTAssertEqual(state.activePlayerID, "p1")
        XCTAssertEqual(state.pendingInputs, ["p1"])
        state = try GameEngine.apply(SessionAction(at: 5000, .call(playerId: "p1", call: .later)), to: state)
        XCTAssertEqual(state.call, .later)
        XCTAssertTrue(state.canReveal)
        state = try GameEngine.apply(SessionAction(at: 6000, .reveal), to: state)
        XCTAssertEqual(state.eliminated, ["p1"])
        XCTAssertEqual(state.referenceCard, card("c1", 1980))
        XCTAssertEqual(state.activePlayerID, "p2")
    }

    func testDailyPendingSwitchesFromPickToGuess() throws {
        let options = GameOptions.daily(DailyOptions(date: "2026-10-11", cards: ["a", "b", "c", "d"]))
        let years = ["a": 1960, "b": 1970, "c": 1980, "d": 1990]
        var actions: [GameAction] = []
        for id in ["a", "b", "c"] { actions += [.draw(card: card(id, years[id]!)), .pickEra(playerId: "p1", era: "mod"), .reveal] }
        var state = try play(options, players: 1, actions + [.draw(card: card("d", 1990))])
        XCTAssertEqual(state.pendingInputs, ["p1"])
        XCTAssertThrowsError(try GameEngine.apply(SessionAction(at: 99_000, .pickEra(playerId: "p1", era: "zine")), to: state))
        state = try GameEngine.apply(SessionAction(at: 99_000, .guess(playerId: "p1", year: 1991)), to: state)
        XCTAssertEqual(state.pendingInputs, [])
        XCTAssertTrue(state.canReveal)
    }

    func testTimelineAndRelayLines() throws {
        let timeline = GameOptions.timeline(TimelineOptions())
        var state = try play(timeline, players: 2, [.anchor(playerId: "p1", card: card("a1", 1980)), .anchor(playerId: "p2", card: card("a2", 2000)), .draw(card: card("c1", 1990))])
        XCTAssertEqual(state.timeline(for: "p1"), [card("a1", 1980)])
        XCTAssertEqual(state.tokens(for: "p2"), 2)
        XCTAssertFalse(state.hasPlaced)
        XCTAssertEqual(state.pendingInputs, ["p1"])
        state = try GameEngine.apply(SessionAction(at: 5000, .place(playerId: "p1", slot: 1)), to: state)
        state = try GameEngine.apply(SessionAction(at: 6000, .challenge(playerId: "p2", slot: 0)), to: state)
        XCTAssertTrue(state.hasPlaced)
        XCTAssertEqual(state.placement, 1)
        XCTAssertEqual(state.challenges, [ChallengeInPlay(playerId: "p2", slot: 0)])
        XCTAssertEqual(state.tokens(for: "p2"), 1)
        XCTAssertEqual(state.pendingInputs, [])

        var relayOptions = RelayOptions()
        relayOptions.lives = 1
        let relay = try play(.relay(relayOptions), players: 2, [.anchor(playerId: nil, card: card("a", 1980)), .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 0), .reveal])
        XCTAssertEqual(relay.timeline(for: nil), [card("a", 1980)])
        XCTAssertEqual(relay.lives, 0)
        XCTAssertEqual(relay.outcome, "lost")
        XCTAssertNil(relay.activePlayerID)
    }

    func testLadderLocksMarksAndStep() throws {
        var ladder = LadderOptions()
        ladder.steps = [1000, 5000]
        var state = try play(.ladder(ladder), players: 2, [.draw(card: card("c1", 1984))])
        XCTAssertEqual(state.ladderStep, -1)
        XCTAssertEqual(state.pendingInputs, ["p1", "p2"])
        state = try GameEngine.apply(SessionAction(at: 5000, .step(index: 0)), to: state)
        state = try GameEngine.apply(SessionAction(at: 6000, .lock(playerId: "p1", year: nil)), to: state)
        XCTAssertEqual(state.locks, ["p1": LockInPlay(step: 0, year: nil)])
        XCTAssertEqual(state.pendingInputs, ["p1", "p2"])
        state = try GameEngine.apply(SessionAction(at: 7000, .step(index: 1)), to: state)
        // At the last step unlocked players owe nothing; p1 still needs a mark.
        XCTAssertEqual(state.pendingInputs, ["p1"])
        state = try GameEngine.apply(SessionAction(at: 8000, .mark(playerId: "p1", titleOK: true, artistOK: false)), to: state)
        XCTAssertEqual(state.marks, ["p1": MarksInPlay(titleOK: true, artistOK: false)])
        XCTAssertEqual(state.pendingInputs, [])
        XCTAssertTrue(state.canReveal)
    }

    func testLineupAndImposterInputs() throws {
        let set = [card("a", 1960), card("b", 1970), card("c", 1980)]
        let lineup = try play(.lineup(LineupOptions(k: 3)), players: 1, [.drawSet(cards: set), .order(playerId: "p1", order: ["a", "c", "b"])])
        XCTAssertEqual(lineup.currentSet, set)
        XCTAssertEqual(lineup.orders, ["p1": ["a", "c", "b"]])
        XCTAssertTrue(lineup.canReveal)

        let imposter = try play(.imposter(ImposterOptions()), players: 2, [.drawPair(a: card("a", 1960), b: card("b", 1990), original: .a), .choose(playerId: "p2", pick: .b, year: 1990)])
        XCTAssertEqual(imposter.currentPair, PairInPlay(a: card("a", 1960), b: card("b", 1990), original: .a))
        XCTAssertEqual(imposter.choices, ["p2": ChoiceInPlay(pick: .b, year: 1990)])
        XCTAssertEqual(imposter.pendingInputs, ["p1"])
    }

    func testImposterRemembersPairsAfterSkip() throws {
        let state = try play(.imposter(ImposterOptions()), players: 2, [.drawPair(a: card("b", 1990), b: card("a", 1960), original: .b), .skip])
        XCTAssertTrue(state.wasPaired("a", "b"))
        XCTAssertTrue(state.wasPaired("b", "a"))
        XCTAssertFalse(state.wasPaired("a", "c"))
        XCTAssertEqual(state.phase, .awaitingDraw)
    }

    func testPlayerRanges() {
        XCTAssertEqual(GameMode.daily.playerRange, 1...1)
        XCTAssertEqual(GameMode.timeline.playerRange, 2...8)
        XCTAssertEqual(GameMode.bullseye.playerRange, 1...10)
    }

    func testDailyRoundKind() throws {
        XCTAssertEqual(try (1...5).map(Scoring.dailyRoundKind), [.eraSort, .eraSort, .eraSort, .bullseye, .bullseye])
        for round in [0, -1] { XCTAssertThrowsError(try Scoring.dailyRoundKind(round)) }
    }
}
