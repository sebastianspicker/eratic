import Foundation
import XCTest
@testable import EraticCore

final class SessionCodecTests: XCTestCase {
    private func sample() -> GameSession {
        GameSession(id: "s-20261011-1", createdAt: "2026-10-11T19:30:00Z", deckId: "demo-deck", deckTitle: "Demo deck",
                    options: .bullseye(BullseyeOptions(rounds: 1)), seed: 42,
                    players: [SessionPlayer(id: "p1", name: "Ada"), SessionPlayer(id: "p2", name: "Lin", members: ["Lin", "Max"])],
                    actions: [SessionAction(at: 0, .draw(card: CardRef(cardId: "c1", year: 1984))), SessionAction(at: 10, .clip(fromMs: 0, lengthMs: 5000)),
                              SessionAction(at: 20, .guess(playerId: "p1", year: 1984)), SessionAction(at: 30, .guess(playerId: "p2", year: 1980)),
                              SessionAction(at: 40, .reveal)])
    }

    private func object(_ session: GameSession) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: SessionCodec.encode(session)) as? [String: Any])
    }

    private func data(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object)
    }

    func testRoundTripAndNormalisedOptions() throws {
        let session = sample()
        let encoded = try SessionCodec.encode(session)
        XCTAssertEqual(try SessionCodec.decode(encoded), session)
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertTrue(text.contains(#""options":{"rounds":1,"stakes":false}"#), text)
        XCTAssertTrue(text.hasPrefix(#"{"actions":"#))
        XCTAssertTrue(try SessionCodec.decode(Data([0xEF, 0xBB, 0xBF]) + encoded) == session)
        var minimal = try object(session)
        minimal["options"] = [String: Any]()
        XCTAssertEqual(try SessionCodec.decode(data(minimal)).options, .bullseye(BullseyeOptions()))
    }

    private func ladderSession(version: Int, options: [String: Any]) throws -> Data {
        var root = try object(sample())
        root["sessionVersion"] = version
        root["mode"] = "ladder"
        root["options"] = options
        root["actions"] = [[String: Any]]()
        return try data(root)
    }

    func testLadderStepsFollowSessionVersion() throws {
        // Version 2 caps steps at 30 s.
        XCTAssertNoThrow(try SessionCodec.decode(ladderSession(version: 2, options: ["steps": [500, 30000]])))
        XCTAssertThrowsError(try SessionCodec.decode(ladderSession(version: 2, options: ["steps": [1000, 30001]])))
        XCTAssertThrowsError(try SessionCodec.decode(ladderSession(version: 2, options: ["steps": [1000, 60000]])))
        // Version 1 keeps 600000 and its old default.
        XCTAssertNoThrow(try SessionCodec.decode(ladderSession(version: 1, options: ["steps": [1000, 60000]])))
        XCTAssertThrowsError(try SessionCodec.decode(ladderSession(version: 1, options: ["steps": [1000, 600_001]])))
        let v1 = try SessionCodec.decode(ladderSession(version: 1, options: [String: Any]()))
        XCTAssertEqual(v1.options, .ladder({ var o = LadderOptions(); o.steps = [1000, 5000, 10000, 30000, 60000]; return o }()))
        let v2 = try SessionCodec.decode(ladderSession(version: 2, options: [String: Any]()))
        guard case let .ladder(options) = v2.options else { return XCTFail("expected ladder options") }
        XCTAssertEqual(options.steps, [1000, 5000, 10000, 20000, 30000])
    }

    func testVersionIsKeptOnRoundTrip() throws {
        XCTAssertEqual(GameSession.version, 2)
        XCTAssertEqual(sample().sessionVersion, 2)
        let v1 = try SessionCodec.decode(ladderSession(version: 1, options: [String: Any]()))
        XCTAssertEqual(v1.sessionVersion, 1)
        XCTAssertEqual(try object(v1)["sessionVersion"] as? Int, 1)
        XCTAssertEqual(try SessionCodec.decode(SessionCodec.encode(v1)), v1)
        XCTAssertEqual(try object(sample())["sessionVersion"] as? Int, 2)
    }

    func testEveryActionShapeRoundTrips() throws {
        var timeline = TimelineOptions()
        timeline.anchor = .custom
        timeline.anchorYear = 1985
        timeline.nameIt = true
        timeline.stakes = true
        let session = GameSession(id: "s1", createdAt: "2026-10-11T19:30:00Z", deckId: "d", deckTitle: "D", options: .timeline(timeline), seed: 0,
                                  players: [SessionPlayer(id: "p1", name: "A"), SessionPlayer(id: "p2", name: "B")],
                                  actions: [SessionAction(at: 0, .anchor(playerId: "p1", card: CardRef(cardId: "a1", year: 1985))),
                                            SessionAction(at: 0, .anchor(playerId: "p2", card: CardRef(cardId: "a2", year: 1985))),
                                            SessionAction(at: 1, .draw(card: CardRef(cardId: "c1", year: 1990))),
                                            SessionAction(at: 2, .place(playerId: "p1", slot: 1)),
                                            SessionAction(at: 3, .challenge(playerId: "p2", slot: 0)),
                                            SessionAction(at: 4, .nameIt(playerId: "p1", titleOK: true, artistOK: false)),
                                            SessionAction(at: 5, .wager(playerId: "p1", chips: 1)),
                                            SessionAction(at: 6, .reveal), SessionAction(at: 7, .end)])
        XCTAssertEqual(try SessionCodec.decode(SessionCodec.encode(session)), session)
        let replayed = try GameEngine.replay(session)
        XCTAssertEqual(replayed.phase, .finished)
    }

    func testStructuralRejections() throws {
        let base = try object(sample())
        func rejects(_ change: (inout [String: Any]) -> Void, line: UInt = #line) throws {
            var copy = base
            change(&copy)
            XCTAssertThrowsError(try SessionCodec.decode(data(copy)), line: line)
        }
        try rejects { $0["extra"] = 1 }
        try rejects { $0["deckTitle"] = NSNull() }
        try rejects { $0.removeValue(forKey: "createdAt") }
        try rejects { $0["format"] = "eratic-deck" }
        try rejects { $0["sessionVersion"] = 3 }
        try rejects { $0["sessionVersion"] = 0 }
        try rejects { $0["mode"] = "bingo" }
        try rejects { $0["createdAt"] = "2026-10-11 19:30:00" }
        try rejects { $0["id"] = "-bad" }
        try rejects { $0["deckTitle"] = " " }
        try rejects { $0["seed"] = 4_294_967_296 }
        try rejects { $0["seed"] = -1 }
        try rejects { $0["seed"] = 1.5 }
        try rejects { $0["seed"] = true }
        try rejects { $0["players"] = [["id": "p1", "name": String(repeating: "a", count: 41)]] }
        try rejects { $0["players"] = [["id": "p1", "name": "A"], ["id": "p1", "name": "B"]] }
        try rejects { $0["players"] = [["id": "p1", "name": "A", "members": Array(repeating: "m", count: 9)]] }
        try rejects { $0["players"] = [["id": String(repeating: "p", count: 33), "name": "A"]] }
        try rejects { $0["players"] = [[String: Any]]() }
        XCTAssertThrowsError(try SessionCodec.decode(Data(#"{"format":"eratic-session","format":"eratic-session"}"#.utf8)))
        XCTAssertThrowsError(try SessionCodec.decode(Data(repeating: 32, count: SessionCodec.maximumBytes + 1)))
    }

    func testOptionAndActionErrorsCarryTheirIndex() throws {
        let base = try object(sample())
        func index(_ change: (inout [String: Any]) -> Void) throws -> Int? {
            var copy = base
            change(&copy)
            do {
                _ = try SessionCodec.decode(data(copy))
                return nil
            } catch let error as GameError {
                return error.actionIndex
            }
        }
        XCTAssertEqual(try index { $0["options"] = ["rounds": 1, "kids": true] }, -1)
        XCTAssertEqual(try index { $0["options"] = ["rounds": 0] }, -1)
        XCTAssertEqual(try index { $0["options"] = ["rounds": "1"] }, -1)
        XCTAssertEqual(try index { $0["mode"] = "daily"; $0["options"] = [String: Any]() }, -1)
        XCTAssertEqual(try index { $0["mode"] = "timeline"; $0["options"] = [String: Any]() }, 0)
        var actions = try XCTUnwrap(base["actions"] as? [[String: Any]])
        actions[2]["extra"] = true
        XCTAssertEqual(try index { $0["actions"] = actions }, 2)
        actions = try XCTUnwrap(base["actions"] as? [[String: Any]])
        actions[1]["type"] = "dance"
        XCTAssertEqual(try index { $0["actions"] = actions }, 1)
        actions = try XCTUnwrap(base["actions"] as? [[String: Any]])
        actions[3]["year"] = 2101
        XCTAssertEqual(try index { $0["actions"] = actions }, 3)
        actions = try XCTUnwrap(base["actions"] as? [[String: Any]])
        actions[4]["at"] = 5
        XCTAssertEqual(try index { $0["actions"] = actions }, 4)
        actions = try XCTUnwrap(base["actions"] as? [[String: Any]])
        actions[0]["card"] = ["cardId": "c1", "year": 1984, "era": "neon", "title": "x"]
        XCTAssertEqual(try index { $0["actions"] = actions }, 0)
    }

    func testEncodeRejectsInvalidSessions() {
        var session = sample()
        session.actions.append(SessionAction(at: 50, .reveal))
        XCTAssertThrowsError(try SessionCodec.encode(session))
        session = sample()
        session.deckTitle = ""
        XCTAssertThrowsError(try SessionCodec.encode(session))
    }
}
