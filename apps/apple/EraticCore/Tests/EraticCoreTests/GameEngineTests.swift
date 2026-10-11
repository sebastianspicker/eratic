import Foundation
import XCTest
@testable import EraticCore

final class GameEngineTests: XCTestCase {
    private func card(_ id: String, _ year: Int) -> CardRef { CardRef(cardId: id, year: year) }

    private func players(_ count: Int) -> [SessionPlayer] {
        (1...count).map { SessionPlayer(id: "p\($0)", name: "Player \($0)") }
    }

    /// Replays `actions` (one second apart) and returns the summary.
    private func run(_ options: GameOptions, players count: Int, _ actions: [GameAction], file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        var state = try GameEngine.start(options: options, players: players(count), seed: 1)
        for (index, action) in actions.enumerated() { state = try GameEngine.apply(SessionAction(at: index * 1000, action), to: state) }
        return GameEngine.summary(of: state)
    }

    private func assertRejected(_ options: GameOptions, players count: Int, _ actions: [GameAction], at index: Int, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try run(options, players: count, actions), file: file, line: line) { error in
            XCTAssertEqual((error as? GameError)?.actionIndex, index, "\(error)", file: file, line: line)
        }
    }

    private func check(_ summary: [String: Any], _ expected: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
        assertPartialEqual(summary, expected, "summary", file: file, line: line)
    }

    // MARK: Setup and common actions

    func testSetupErrorsAreIndexMinusOne() {
        var timeline = TimelineOptions()
        timeline.anchor = .custom
        var anchorYearWithoutCustom = TimelineOptions()
        anchorYearWithoutCustom.anchorYear = 1980
        var ladder = LadderOptions()
        ladder.steps = [1000, 1000]
        for (options, count) in [(GameOptions.bullseye(BullseyeOptions(rounds: 0)), 1), (.bullseye(BullseyeOptions()), 11), (.timeline(timeline), 2),
                                 (.timeline(anchorYearWithoutCustom), 2), (.timeline(TimelineOptions()), 1), (.ladder(ladder), 1),
                                 (.higherLower(HigherLowerOptions(cards: 1)), 1), (.lineup(LineupOptions(k: 6)), 1),
                                 (.daily(DailyOptions(date: "2026-02-29", cards: ["c1"])), 1), (.daily(DailyOptions(date: "2026-02-28", cards: ["c1", "c1"])), 1),
                                 (.daily(DailyOptions(date: "2026-02-28", cards: ["c1"])), 2), (.imposter(ImposterOptions()), 1)] {
            XCTAssertThrowsError(try GameEngine.start(options: options, players: players(count))) { error in
                XCTAssertEqual((error as? GameError)?.actionIndex, -1, "\(options)")
            }
        }
    }

    func testCommonActions() throws {
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1))
        assertRejected(options, players: 1, [.clip(fromMs: 0, lengthMs: nil)], at: 0)
        assertRejected(options, players: 1, [.draw(card: card("c1", 1984)), .clip(fromMs: 0, lengthMs: 0)], at: 1)
        assertRejected(options, players: 1, [.draw(card: card("c1", 1984)), .clip(fromMs: -1, lengthMs: nil)], at: 1)
        assertRejected(options, players: 1, [.skip], at: 0)
        assertRejected(options, players: 1, [.draw(card: card("c1", 1984)), .skip, .draw(card: card("c1", 1984))], at: 2)
        assertRejected(options, players: 1, [.draw(card: CardRef(cardId: "c1", year: 1984, era: "zine"))], at: 0)
        assertRejected(options, players: 1, [.draw(card: card("c 1", 1984))], at: 0)
        assertRejected(options, players: 1, [.draw(card: card("c1", 1849))], at: 0)
        assertRejected(options, players: 1, [.end, .end], at: 1)
        // A skipped card's inputs are gone and no round is counted.
        let skipped = try run(options, players: 1, [.draw(card: card("c1", 1984)), .clip(fromMs: 0, lengthMs: 5000), .guess(playerId: "p1", year: 1984), .skip,
                                                    .draw(card: card("c2", 1990)), .guess(playerId: "p1", year: 1980)])
        check(skipped, ["phase": "open", "round": 0, "scores": ["p1": 0]])
        let ended = try run(options, players: 1, [.draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1984), .end])
        check(ended, ["phase": "finished", "round": 0, "standings": [["p1"]]])
    }

    func testTimeMustNotGoBackwards() throws {
        let state = try GameEngine.start(options: .bullseye(BullseyeOptions()), players: players(1))
        let drawn = try GameEngine.apply(SessionAction(at: 500, .draw(card: card("c1", 1984))), to: state)
        XCTAssertThrowsError(try GameEngine.apply(SessionAction(at: 499, .guess(playerId: "p1", year: 1984)), to: drawn)) { error in
            XCTAssertEqual(error as? GameError, GameError(actionIndex: 1, message: (error as? GameError)?.message ?? ""))
        }
        XCTAssertNoThrow(try GameEngine.apply(SessionAction(at: 500, .guess(playerId: "p1", year: 1984)), to: drawn))
    }

    // MARK: Bullseye

    func testBullseyeGame() throws {
        let summary = try run(.bullseye(BullseyeOptions(rounds: 2)), players: 2, [
            .draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1984), .guess(playerId: "p2", year: 1990), .reveal,
            .draw(card: card("c2", 2001)), .guess(playerId: "p2", year: 2003), .guess(playerId: "p1", year: 1990), .reveal,
        ])
        check(summary, ["phase": "finished", "round": 2, "scores": ["p1": 10, "p2": 6], "standings": [["p1"], ["p2"]],
                        "exact": ["p1": 1, "p2": 0], "distance": ["p1": 11, "p2": 8]])
        XCTAssertNil(summary["active"])
        XCTAssertNil(summary["chips"])
    }

    func testBullseyeRejections() {
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1))
        let open: [GameAction] = [.draw(card: card("c1", 1984))]
        assertRejected(options, players: 2, open + [.guess(playerId: "p1", year: 1984), .guess(playerId: "p1", year: 1985)], at: 2)
        assertRejected(options, players: 2, open + [.guess(playerId: "p1", year: 1984), .reveal], at: 2)
        assertRejected(options, players: 2, open + [.guess(playerId: "p9", year: 1984)], at: 1)
        assertRejected(options, players: 2, open + [.guess(playerId: "p1", year: 2101)], at: 1)
        assertRejected(options, players: 2, open + [.pickEra(playerId: "p1", era: "neon")], at: 1)
        assertRejected(options, players: 2, [.guess(playerId: "p1", year: 1984)], at: 0)
        assertRejected(options, players: 1, open + [.guess(playerId: "p1", year: 1984), .reveal, .draw(card: card("c2", 1990))], at: 3)
        assertRejected(options, players: 1, open + [.wager(playerId: "p1", chips: 1)], at: 1)
    }

    func testBullseyeStakes() throws {
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1, stakes: true))
        let open: [GameAction] = [.draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1986)]
        assertRejected(options, players: 1, open + [.reveal], at: 2)
        assertRejected(options, players: 1, open + [.wager(playerId: "p1", chips: 4)], at: 2)
        assertRejected(options, players: 1, open + [.wager(playerId: "p1", chips: 0)], at: 2)
        assertRejected(options, players: 1, open + [.wager(playerId: "p1", chips: 1), .wager(playerId: "p1", chips: 1)], at: 3)
        let won = try run(options, players: 1, open + [.wager(playerId: "p1", chips: 3), .reveal])
        check(won, ["scores": ["p1": 13], "chips": ["p1": 8]])
        let lost = try run(options, players: 1, [.draw(card: card("c1", 1984)), .wager(playerId: "p1", chips: 2), .guess(playerId: "p1", year: 1990), .reveal])
        check(lost, ["scores": ["p1": 4], "chips": ["p1": 3]])
    }

    func testBullseyeSuddenDeath() throws {
        let tie: [GameAction] = [.draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1980), .guess(playerId: "p2", year: 1988),
                                 .guess(playerId: "p3", year: 2000), .reveal]
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1))
        check(try run(options, players: 3, tie), ["phase": "suddenDeath", "round": 1, "suddenDeath": ["kind": "closestYear", "players": ["p1", "p2"]],
                                                  "standings": [["p1", "p2"], ["p3"]]])
        assertRejected(options, players: 3, tie + [.sdDraw(cards: [card("c2", 1990)]), .sdGuess(playerId: "p3", year: 1990)], at: 6)
        assertRejected(options, players: 3, tie + [.sdDraw(cards: [card("c2", 1990), card("c3", 1991)])], at: 5)
        assertRejected(options, players: 3, tie + [.sdDraw(cards: [card("c1", 1984)])], at: 5)
        assertRejected(options, players: 3, tie + [.sdDraw(cards: [card("c2", 1990)]), .sdGuess(playerId: "p1", year: 1990), .reveal], at: 7)
        let tiedAgain = tie + [.sdDraw(cards: [card("c2", 1990)]), .sdGuess(playerId: "p1", year: 1989), .sdGuess(playerId: "p2", year: 1991), .reveal]
        check(try run(options, players: 3, tiedAgain), ["phase": "suddenDeath", "round": 1, "suddenDeath": ["kind": "closestYear", "players": ["p1", "p2"]]])
        let won = tiedAgain + [.sdDraw(cards: [card("c3", 1970)]), .clip(fromMs: 0, lengthMs: nil), .sdGuess(playerId: "p2", year: 1971), .sdGuess(playerId: "p1", year: 1975), .reveal]
        let summary = try run(options, players: 3, won)
        check(summary, ["phase": "finished", "round": 1, "standings": [["p2"], ["p1"], ["p3"]], "scores": ["p1": 3, "p2": 3, "p3": 0]])
        XCTAssertNil(summary["suddenDeath"])
        check(try run(options, players: 3, tiedAgain + [.sdDraw(cards: [card("c3", 1970)]), .end]), ["phase": "finished", "standings": [["p1", "p2"], ["p3"]]])
    }

    func testSuddenDeathEliminationRounds() throws {
        // Four players tie; round 1 eliminates p4, round 2 eliminates p3, p1 wins round 3.
        let options = GameOptions.bullseye(BullseyeOptions(rounds: 1))
        let actions: [GameAction] = [.draw(card: card("c1", 1984))] + (1...4).map { .guess(playerId: "p\($0)", year: 1984) } + [.reveal,
            .sdDraw(cards: [card("c2", 1990)])] + [1990, 1990, 1990, 1999].enumerated().map { .sdGuess(playerId: "p\($0.offset + 1)", year: $0.element) } + [.reveal,
            .sdDraw(cards: [card("c3", 1990)]), .sdGuess(playerId: "p1", year: 1990), .sdGuess(playerId: "p2", year: 1990), .sdGuess(playerId: "p3", year: 1980), .reveal]
        check(try run(options, players: 4, actions), ["phase": "suddenDeath", "standings": [["p1", "p2"], ["p3"], ["p4"]]])
        let won = actions + [.sdDraw(cards: [card("c4", 1990)]), .sdGuess(playerId: "p1", year: 1990), .sdGuess(playerId: "p2", year: 1980), .reveal]
        check(try run(options, players: 4, won), ["phase": "finished", "standings": [["p1"], ["p2"], ["p3"], ["p4"]]])
    }

    // MARK: Era Sort

    func testEraSort() throws {
        let kids = GameOptions.eraSort(EraSortOptions(rounds: 1, kids: true))
        let round: [GameAction] = [.draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "neon"), .pickEra(playerId: "p2", era: "zine"), .reveal]
        check(try run(kids, players: 2, round), ["phase": "suddenDeath", "scores": ["p1": 3, "p2": 3], "rightEras": ["p1": 1, "p2": 1],
                                                 "suddenDeath": ["kind": "closestYear", "players": ["p1", "p2"]]])
        check(try run(.eraSort(EraSortOptions(rounds: 1)), players: 2, round), ["phase": "finished", "scores": ["p1": 3, "p2": 1], "rightEras": ["p1": 1, "p2": 0]])
        assertRejected(kids, players: 2, [.draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "vinyl")], at: 1)
        assertRejected(kids, players: 2, [.draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "neon"), .reveal], at: 2)
    }

    // MARK: Timeline

    private let timelineAnchors: [GameAction] = [.anchor(playerId: "p1", card: CardRef(cardId: "a1", year: 1980)), .anchor(playerId: "p2", card: CardRef(cardId: "a2", year: 2000))]

    func testPersonalTimelineGame() throws {
        var options = TimelineOptions()
        options.target = 2
        let actions = timelineAnchors + [
            .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 1), .reveal,
            .draw(card: card("c2", 1970)), .place(playerId: "p2", slot: 1), .challenge(playerId: "p1", slot: 0), .reveal,
        ]
        check(try run(.timeline(options), players: 2, Array(actions.prefix(5))), ["phase": "awaitingDraw", "active": "p2", "round": 1,
                                                                                 "timelines": ["p1": ["a1", "c1"], "p2": ["a2"]]])
        check(try run(.timeline(options), players: 2, actions), [
            "phase": "finished", "round": 2, "scores": ["p1": 3, "p2": 1], "standings": [["p1"], ["p2"]],
            "timelines": ["p1": ["c2", "a1", "c1"], "p2": ["a2"]], "tokens": ["p1": 1, "p2": 2], "wrong": ["p1": 0, "p2": 0],
        ])
    }

    func testTimelineWrongPlacementWithoutChallenger() throws {
        let actions = timelineAnchors + [.draw(card: card("c1", 1970)), .place(playerId: "p1", slot: 1), .challenge(playerId: "p2", slot: 0), .reveal]
        // p2's challenge at slot 0 is right, so p2 takes the card into their own timeline and p1's wrong count stays 0.
        check(try run(.timeline(TimelineOptions()), players: 2, actions), ["timelines": ["p1": ["a1"], "p2": ["c1", "a2"]], "wrong": ["p1": 0, "p2": 0]])
        let unchallenged = timelineAnchors + [.draw(card: card("c1", 1970)), .place(playerId: "p1", slot: 1), .reveal]
        check(try run(.timeline(TimelineOptions()), players: 2, unchallenged), ["timelines": ["p1": ["a1"], "p2": ["a2"]], "wrong": ["p1": 1, "p2": 0], "active": "p2"])
    }

    func testTimelineRejections() throws {
        let options = GameOptions.timeline(TimelineOptions())
        let open = timelineAnchors + [.draw(card: card("c1", 1990))]
        assertRejected(options, players: 2, [.anchor(playerId: "p2", card: card("a2", 2000))], at: 0)
        assertRejected(options, players: 2, [.anchor(playerId: nil, card: card("a1", 1980))], at: 0)
        assertRejected(options, players: 2, [.draw(card: card("c1", 1990))], at: 0)
        assertRejected(options, players: 2, open + [.place(playerId: "p2", slot: 0)], at: 3)
        assertRejected(options, players: 2, open + [.place(playerId: "p1", slot: 2)], at: 3)
        assertRejected(options, players: 2, open + [.challenge(playerId: "p2", slot: 0)], at: 3)
        assertRejected(options, players: 2, open + [.place(playerId: "p1", slot: 1), .challenge(playerId: "p1", slot: 0)], at: 4)
        assertRejected(options, players: 2, open + [.place(playerId: "p1", slot: 1), .challenge(playerId: "p2", slot: 1)], at: 4)
        assertRejected(options, players: 2, open + [.place(playerId: "p1", slot: 1), .challenge(playerId: "p2", slot: 0), .challenge(playerId: "p2", slot: 0)], at: 5)
        assertRejected(options, players: 2, open + [.place(playerId: "p1", slot: 1), .nameIt(playerId: "p1", titleOK: true, artistOK: true)], at: 4)
        assertRejected(options, players: 2, open + [.reveal], at: 3)
        var noChallenges = TimelineOptions()
        noChallenges.challenges = false
        assertRejected(.timeline(noChallenges), players: 2, open + [.place(playerId: "p1", slot: 1), .challenge(playerId: "p2", slot: 0)], at: 4)
        var noTokens = TimelineOptions()
        noTokens.tokens = 0
        assertRejected(.timeline(noTokens), players: 2, open + [.place(playerId: "p1", slot: 1), .challenge(playerId: "p2", slot: 0)], at: 4)
        var three = TimelineOptions()
        three.tokens = 1
        // Three players: a second challenger can't reuse an earlier challenge's slot.
        let threeOpen: [GameAction] = [.anchor(playerId: "p1", card: card("a1", 1980)), .anchor(playerId: "p2", card: card("a2", 2000)),
                                       .anchor(playerId: "p3", card: card("a3", 1960)), .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 1)]
        assertRejected(.timeline(three), players: 3, threeOpen + [.challenge(playerId: "p2", slot: 0), .challenge(playerId: "p3", slot: 0)], at: 6)
    }

    func testTimelineSkipRefundsTokens() throws {
        let actions = timelineAnchors + [.draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 0), .challenge(playerId: "p2", slot: 1)]
        check(try run(.timeline(TimelineOptions()), players: 2, actions), ["tokens": ["p1": 2, "p2": 1]])
        check(try run(.timeline(TimelineOptions()), players: 2, actions + [.skip]), ["tokens": ["p1": 2, "p2": 2], "active": "p1", "round": 0, "phase": "awaitingDraw"])
    }

    func testTimelineNameItAndStakes() throws {
        var options = TimelineOptions()
        options.nameIt = true
        options.stakes = true
        let base = timelineAnchors + [.draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 0)]
        assertRejected(.timeline(options), players: 2, base + [.reveal], at: 4)
        assertRejected(.timeline(options), players: 2, base + [.wager(playerId: "p2", chips: 1)], at: 4)
        assertRejected(.timeline(options), players: 2, timelineAnchors + [.draw(card: card("c1", 1990)), .wager(playerId: "p1", chips: 1)], at: 3)
        let summary = try run(.timeline(options), players: 2, base + [.nameIt(playerId: "p1", titleOK: true, artistOK: true), .wager(playerId: "p1", chips: 2), .reveal])
        check(summary, ["tokens": ["p1": 3, "p2": 2], "chips": ["p1": 3, "p2": 5], "wrong": ["p1": 1, "p2": 0], "scores": ["p1": 4, "p2": 6]])
    }

    func testSharedTimelineSuddenDeath() throws {
        var options = TimelineOptions()
        options.ownership = .shared
        options.target = 3
        let actions: [GameAction] = [
            .anchor(playerId: nil, card: card("a0", 1980)),
            .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 1), .reveal,
            .draw(card: card("c2", 1970)), .place(playerId: "p2", slot: 0), .reveal,
        ]
        check(try run(.timeline(options), players: 2, actions), ["phase": "suddenDeath", "timeline": ["c2", "a0", "c1"], "scores": ["p1": 1, "p2": 1],
                                                                 "suddenDeath": ["kind": "lineup", "players": ["p1", "p2"]]])
        let sd: [GameAction] = [.sdDraw(cards: [card("s1", 1960), card("s2", 1970), card("s3", 1980), card("s4", 1990)]),
                                .sdOrder(playerId: "p1", order: ["s2", "s1", "s3", "s4"]), .sdOrder(playerId: "p2", order: ["s1", "s2", "s3", "s4"]), .reveal]
        check(try run(.timeline(options), players: 2, actions + sd), ["phase": "finished", "standings": [["p2"], ["p1"]]])
        assertRejected(.timeline(options), players: 2, actions + [.sdDraw(cards: [card("s1", 1960)])], at: 7)
        assertRejected(.timeline(options), players: 2, actions + [sd[0], .sdOrder(playerId: "p1", order: ["s1", "s2", "s3"])], at: 8)
    }

    func testTimelineEndWaitsForTheRoundToComplete() throws {
        var options = TimelineOptions()
        options.target = 2
        // p2 reaches the target on the last turn of the round; p1 never does: p2 wins outright.
        let actions = timelineAnchors + [
            .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 0), .reveal,
            .draw(card: card("c2", 2010)), .place(playerId: "p2", slot: 1), .reveal,
        ]
        check(try run(.timeline(options), players: 2, actions), ["phase": "finished", "scores": ["p1": 1, "p2": 2], "standings": [["p2"], ["p1"]]])
    }

    // MARK: Snippet Ladder

    func testLadderNameGame() throws {
        var options = LadderOptions()
        options.rounds = 1
        let actions: [GameAction] = [
            .draw(card: card("c1", 1984)), .step(index: 0), .lock(playerId: "p1", year: nil), .step(index: 1), .step(index: 1),
            .lock(playerId: "p2", year: nil), .mark(playerId: "p1", titleOK: true, artistOK: true), .mark(playerId: "p2", titleOK: true, artistOK: false),
        ]
        check(try run(.ladder(options), players: 2, actions), ["step": 1, "phase": "open"])
        check(try run(.ladder(options), players: 2, actions + [.reveal]), ["phase": "finished", "scores": ["p1": 10, "p2": 4], "usedMs": ["p1": 1000, "p2": 5000],
                                                                           "exactYears": ["p1": 0, "p2": 0], "step": -1, "standings": [["p1"], ["p2"]]])
    }

    func testLadderRejections() {
        var options = LadderOptions()
        options.rounds = 1
        let open: [GameAction] = [.draw(card: card("c1", 1984))]
        assertRejected(.ladder(options), players: 2, open + [.lock(playerId: "p1", year: nil)], at: 1)
        assertRejected(.ladder(options), players: 2, open + [.step(index: 1)], at: 1)
        assertRejected(.ladder(options), players: 2, open + [.step(index: 0), .step(index: 2)], at: 2)
        assertRejected(.ladder(options), players: 2, open + [.step(index: 0), .lock(playerId: "p1", year: 1984)], at: 2)
        assertRejected(.ladder(options), players: 2, open + [.step(index: 0), .mark(playerId: "p1", titleOK: true, artistOK: true)], at: 2)
        assertRejected(.ladder(options), players: 2, open + [.step(index: 0), .lock(playerId: "p1", year: nil), .reveal], at: 3)
        assertRejected(.ladder(options), players: 1, open + [.step(index: 0), .lock(playerId: "p1", year: nil), .reveal], at: 3)
        assertRejected(.ladder(options), players: 1, open + [.reveal], at: 1)
        var short = LadderOptions()
        short.steps = [1000]
        assertRejected(.ladder(short), players: 1, open + [.step(index: 0), .step(index: 1)], at: 2)
        var year = LadderOptions()
        year.guess = .year
        assertRejected(.ladder(year), players: 1, open + [.step(index: 0), .lock(playerId: "p1", year: nil)], at: 2)
        assertRejected(.ladder(year), players: 1, open + [.step(index: 0), .lock(playerId: "p1", year: 1984), .mark(playerId: "p1", titleOK: true, artistOK: true)], at: 3)
    }

    func testLadderYearAndBothModes() throws {
        var year = LadderOptions()
        year.rounds = 1
        year.guess = .year
        year.steps = [1000, 2000]
        let summary = try run(.ladder(year), players: 2, [.draw(card: card("c1", 1984)), .step(index: 0), .lock(playerId: "p1", year: 1984), .step(index: 1), .reveal])
        check(summary, ["scores": ["p1": 5, "p2": 0], "exactYears": ["p1": 1, "p2": 0], "usedMs": ["p1": 1000, "p2": 2000]])
        var both = year
        both.guess = .both
        let bothSummary = try run(.ladder(both), players: 1, [.draw(card: card("c1", 1984)), .step(index: 0), .step(index: 1), .lock(playerId: "p1", year: 1986),
                                                             .mark(playerId: "p1", titleOK: true, artistOK: false), .reveal])
        check(bothSummary, ["scores": ["p1": 5], "exactYears": ["p1": 0], "usedMs": ["p1": 2000]])
    }

    func testLadderFirstToNameSuddenDeath() throws {
        var options = LadderOptions()
        options.rounds = 1
        options.steps = [1000, 2000]
        let tie: [GameAction] = [.draw(card: card("c1", 1984)), .step(index: 0), .step(index: 1), .reveal]
        check(try run(.ladder(options), players: 2, tie), ["phase": "suddenDeath", "usedMs": ["p1": 2000, "p2": 2000],
                                                           "suddenDeath": ["kind": "firstToName", "players": ["p1", "p2"]], "step": -1])
        let nobody = tie + [.sdDraw(cards: [card("s1", 1990)]), .sdName(playerId: nil), .reveal]
        check(try run(.ladder(options), players: 2, nobody), ["phase": "suddenDeath", "suddenDeath": ["kind": "firstToName", "players": ["p1", "p2"]]])
        let won = nobody + [.sdDraw(cards: [card("s2", 1991)]), .sdName(playerId: "p2"), .reveal]
        check(try run(.ladder(options), players: 2, won), ["phase": "finished", "standings": [["p2"], ["p1"]]])
        assertRejected(.ladder(options), players: 2, tie + [.sdDraw(cards: [card("s1", 1990)]), .sdName(playerId: "p1"), .sdName(playerId: "p2")], at: 6)
        assertRejected(.ladder(options), players: 2, tie + [.sdDraw(cards: [card("s1", 1990)]), .reveal], at: 5)
        assertRejected(.ladder(options), players: 2, tie + [.sdDraw(cards: [card("s1", 1990)]), .step(index: 0)], at: 5)
    }

    // MARK: Higher or Lower

    func testHigherLowerSolo() throws {
        let options = GameOptions.higherLower(HigherLowerOptions())
        let actions: [GameAction] = [.reference(card: card("r", 1980)), .draw(card: card("c1", 1990)), .call(playerId: "p1", call: .later), .reveal,
                                     .draw(card: card("c2", 1950)), .call(playerId: "p1", call: .later), .reveal]
        check(try run(options, players: 1, Array(actions.prefix(4))), ["phase": "awaitingDraw", "active": "p1", "reference": "c1", "streaks": ["p1": 1]])
        check(try run(options, players: 1, actions), ["phase": "finished", "round": 2, "streaks": ["p1": 1], "eliminated": [String](), "reference": "c2", "standings": [["p1"]]])
        assertRejected(options, players: 1, [.draw(card: card("c1", 1990))], at: 0)
        assertRejected(options, players: 1, [.reference(card: card("r", 1980)), .draw(card: card("c1", 1990)), .reveal], at: 2)
    }

    func testHigherLowerVersus() throws {
        let options = GameOptions.higherLower(HigherLowerOptions())
        let actions: [GameAction] = [
            .reference(card: card("r", 1980)),
            .draw(card: card("c1", 1990)), .call(playerId: "p1", call: .later), .reveal,
            .draw(card: card("c2", 1985)), .call(playerId: "p2", call: .later), .reveal,
            .draw(card: card("c3", 2000)), .call(playerId: "p3", call: .earlier), .reveal,
        ]
        check(try run(options, players: 3, Array(actions.prefix(7))), ["active": "p3", "eliminated": ["p2"], "standings": [["p1"], ["p3"], ["p2"]]])
        check(try run(options, players: 3, actions), ["phase": "finished", "eliminated": ["p2", "p3"], "standings": [["p1"], ["p3"], ["p2"]], "scores": ["p1": 1, "p2": 0, "p3": 0]])
        assertRejected(options, players: 3, [.reference(card: card("r", 1980)), .draw(card: card("c1", 1990)), .call(playerId: "p2", call: .later)], at: 2)
        // Versus ends after `cards` reveals.
        let capped = GameOptions.higherLower(HigherLowerOptions(cards: 2))
        let two: [GameAction] = [.reference(card: card("r", 1980)), .draw(card: card("c1", 1990)), .call(playerId: "p1", call: .later), .reveal,
                                 .draw(card: card("c2", 1995)), .call(playerId: "p2", call: .later), .reveal]
        check(try run(capped, players: 2, two), ["phase": "finished", "streaks": ["p1": 1, "p2": 1], "standings": [["p1", "p2"]]])
    }

    // MARK: Relay

    func testRelay() throws {
        var options = RelayOptions()
        options.target = 3
        options.lives = 1
        options.nameIt = true
        let start: [GameAction] = [.anchor(playerId: nil, card: card("a0", 1980)), .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 1),
                                   .nameIt(playerId: "p1", titleOK: true, artistOK: true), .reveal]
        check(try run(.relay(options), players: 2, start), ["lives": 1, "timeline": ["a0", "c1"], "teamScore": 12, "outcome": "playing", "active": "p2",
                                                            "scores": [String: Int](), "standings": [[String]]()])
        check(try run(.relay(options), players: 2, start + [.draw(card: card("c2", 1970)), .place(playerId: "p2", slot: 2), .reveal]),
              ["phase": "finished", "lives": 0, "teamScore": 2, "outcome": "lost"])
        var two = options
        two.lives = 2
        check(try run(.relay(two), players: 2, start + [.draw(card: card("c2", 1970)), .place(playerId: "p2", slot: 0), .reveal]),
              ["phase": "finished", "lives": 2, "timeline": ["c2", "a0", "c1"], "teamScore": 23, "outcome": "won"])
        check(try run(.relay(two), players: 2, start + [.end]), ["phase": "finished", "outcome": "ended"])
        assertRejected(.relay(options), players: 2, [.anchor(playerId: "p1", card: card("a0", 1980))], at: 0)
        assertRejected(.relay(options), players: 2, start + [.draw(card: card("c2", 1970)), .place(playerId: "p1", slot: 0)], at: 6)
        assertRejected(.relay(RelayOptions()), players: 2, [.anchor(playerId: nil, card: card("a0", 1980)), .draw(card: card("c1", 1990)),
                                                            .place(playerId: "p1", slot: 1), .nameIt(playerId: "p1", titleOK: true, artistOK: true)], at: 3)
    }

    func testRelayNameItRestoresALife() throws {
        var options = RelayOptions()
        options.nameIt = true
        let actions: [GameAction] = [.anchor(playerId: nil, card: card("a0", 1980)),
                                     .draw(card: card("c1", 1990)), .place(playerId: "p1", slot: 0), .reveal,
                                     .draw(card: card("c2", 1970)), .place(playerId: "p2", slot: 1), .nameIt(playerId: "p2", titleOK: true, artistOK: true), .reveal]
        check(try run(.relay(options), players: 2, actions), ["lives": 2, "timeline": ["a0"], "active": "p1", "round": 2])
    }

    // MARK: Lineup

    func testLineup() throws {
        let options = GameOptions.lineup(LineupOptions(k: 3, rounds: 1))
        let set: [GameAction] = [.drawSet(cards: [card("c1", 1990), card("c2", 1970), card("c3", 1980)])]
        check(try run(options, players: 2, set + [.order(playerId: "p1", order: ["c2", "c3", "c1"]), .order(playerId: "p2", order: ["c1", "c3", "c2"]), .reveal]),
              ["phase": "finished", "scores": ["p1": 5, "p2": 0], "perfect": ["p1": 1, "p2": 0]])
        check(try run(options, players: 2, set + [.order(playerId: "p1", order: ["c2", "c1", "c3"]), .order(playerId: "p2", order: ["c2", "c1", "c3"]), .reveal]),
              ["phase": "suddenDeath", "suddenDeath": ["kind": "lineup", "players": ["p1", "p2"]]])
        assertRejected(options, players: 2, [.drawSet(cards: [card("c1", 1990), card("c2", 1970)])], at: 0)
        assertRejected(options, players: 2, [.drawSet(cards: [card("c1", 1990), card("c1", 1970), card("c3", 1980)])], at: 0)
        assertRejected(options, players: 2, set + [.order(playerId: "p1", order: ["c2", "c3", "c3"])], at: 1)
        assertRejected(options, players: 2, set + [.order(playerId: "p1", order: ["c2", "c3"])], at: 1)
        assertRejected(options, players: 2, [.draw(card: card("c1", 1990))], at: 0)
    }

    // MARK: Daily Eratic

    func testDaily() throws {
        let options = GameOptions.daily(DailyOptions(date: "2026-10-11", cards: ["c1", "c2", "c3", "c4"]))
        let actions: [GameAction] = [
            .draw(card: card("c1", 1984)), .pickEra(playerId: "p1", era: "neon"), .reveal,
            .draw(card: card("c2", 1955)), .pickEra(playerId: "p1", era: "mod"), .reveal,
            .draw(card: card("c3", 2015)), .pickEra(playerId: "p1", era: "disco"), .reveal,
            .draw(card: card("c4", 1999)), .guess(playerId: "p1", year: 1999), .reveal,
        ]
        let summary = try run(options, players: 1, actions)
        check(summary, ["phase": "finished", "round": 4, "scores": ["p1": 14], "maxScore": 19, "eras": ["neon", "jukebox", "pastel", "zine"],
                        "shareText": "Eratic 2026-10-11 \u{B7} 14/19 \u{B7} Neon Jukebox Pastel Zine"])
        let partial = try run(options, players: 1, Array(actions.prefix(3)))
        XCTAssertNil(partial["shareText"])
        assertRejected(options, players: 1, [.draw(card: card("c2", 1955))], at: 0)
        assertRejected(options, players: 1, [.draw(card: card("c1", 1984)), .guess(playerId: "p1", year: 1984)], at: 1)
        assertRejected(options, players: 1, Array(actions.prefix(9)) + [.draw(card: card("c4", 1999)), .pickEra(playerId: "p1", era: "zine")], at: 10)
    }

    // MARK: Original or Imposter

    func testImposter() throws {
        let options = GameOptions.imposter(ImposterOptions(rounds: 2))
        let pair: GameAction = .drawPair(a: card("c1", 1984), b: card("c2", 1990), original: .b)
        let round: [GameAction] = [pair, .choose(playerId: "p1", pick: .b, year: 1991), .choose(playerId: "p2", pick: .a, year: nil), .reveal]
        check(try run(options, players: 2, round), ["phase": "awaitingDraw", "scores": ["p1": 8, "p2": 0], "bonuses": ["p1": 1, "p2": 0], "standings": [["p1"], ["p2"]]])
        assertRejected(options, players: 2, round + [.drawPair(a: card("c2", 1990), b: card("c1", 1984), original: .a)], at: 4)
        let reuse = try run(options, players: 2, round + [.drawPair(a: card("c1", 1984), b: card("c3", 1970), original: .a),
                                                          .choose(playerId: "p1", pick: .b, year: 1983), .choose(playerId: "p2", pick: .a, year: 1985), .reveal])
        check(reuse, ["phase": "finished", "scores": ["p1": 11, "p2": 8], "bonuses": ["p1": 2, "p2": 1]])
        assertRejected(options, players: 2, [.drawPair(a: card("c1", 1984), b: card("c1", 1984), original: .a)], at: 0)
        assertRejected(options, players: 2, [pair, .choose(playerId: "p1", pick: .a, year: 1849)], at: 1)
        assertRejected(options, players: 2, [pair, .choose(playerId: "p1", pick: .a, year: nil), .reveal], at: 2)
    }
}
