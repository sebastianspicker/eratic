import Foundation
import XCTest
@testable import EraticCore

final class DeckV2Tests: XCTestCase {
    private func demo() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("demo-deck.json")) as? [String: Any])
    }

    private func decode(_ object: [String: Any]) throws -> Deck {
        try DeckCodec.decode(JSONSerialization.data(withJSONObject: object))
    }

    /// The demo deck as version 2 with every new member set.
    private func version2() throws -> [String: Any] {
        var object = try demo()
        object["schemaVersion"] = 2
        object["defaultClipStartMs"] = 15000
        var cards = try XCTUnwrap(object["cards"] as? [[String: Any]])
        cards[0]["clip"] = ["startMs": 0]
        cards[0]["difficulty"] = 2
        cards[1]["relatedTo"] = ["cardId": cards[0]["id"]!, "relation": "coverOf"]
        object["cards"] = cards
        return object
    }

    func testVersion2RoundTrips() throws {
        let deck = try decode(version2())
        XCTAssertEqual(deck.schemaVersion, 2)
        XCTAssertEqual(deck.defaultClipStartMs, 15000)
        XCTAssertEqual(deck.cards[0].clip, CardClip(startMs: 0))
        XCTAssertEqual(deck.cards[1].relatedTo?.relation, .coverOf)
        XCTAssertEqual(deck.clipStartMs(for: deck.cards[0]), 0)
        XCTAssertEqual(deck.clipStartMs(for: deck.cards[1]), 15000)
        XCTAssertEqual(try DeckCodec.decode(DeckCodec.encode(deck)), deck)
    }

    func testVersion1KeepsItsShape() throws {
        let deck = try decode(demo())
        let text = String(decoding: try DeckCodec.encode(deck), as: UTF8.self)
        for member in ["clip", "relatedTo", "difficulty", "defaultClipStartMs"] { XCTAssertFalse(text.contains("\"\(member)\""), member) }
        XCTAssertTrue(text.contains("\"schemaVersion\" : 1"))
    }

    func testMigration() throws {
        let deck = try decode(demo())
        let migrated = try deck.migrated()
        XCTAssertEqual(migrated.schemaVersion, 2)
        var back = migrated
        back.schemaVersion = 1
        XCTAssertEqual(back, deck)
        XCTAssertEqual(try DeckCodec.decode(DeckCodec.encode(migrated)), migrated)
    }

    func testVersion1RejectsVersion2Members() throws {
        let v2 = try version2()
        var object = v2
        object["schemaVersion"] = 1
        XCTAssertThrowsError(try decode(object))
        var deckOnly = try demo()
        deckOnly["defaultClipStartMs"] = 0
        XCTAssertThrowsError(try decode(deckOnly))
        var cardOnly = try demo()
        var cards = try XCTUnwrap(cardOnly["cards"] as? [[String: Any]])
        cards[0]["difficulty"] = 1
        cardOnly["cards"] = cards
        XCTAssertThrowsError(try decode(cardOnly))
        var inMemory = try decode(demo())
        inMemory.cards[0].difficulty = 1
        XCTAssertThrowsError(try DeckCodec.encode(inMemory))
    }

    func testGameFieldEditsMigrateOnlyWhenSet() throws {
        let deck = try decode(demo())
        let first = deck.cards[0].id, second = deck.cards[1].id
        let cleared = try deck.updatingGameFields(clip: nil, difficulty: nil, relatedTo: nil, forCardID: first)
        XCTAssertEqual(cleared, deck)
        let edited = try deck.updatingGameFields(clip: CardClip(startMs: 12_000), difficulty: 3, relatedTo: RelatedCard(cardId: first, relation: .coverOf), forCardID: second)
        XCTAssertEqual(edited.schemaVersion, 2)
        XCTAssertEqual(edited.cards[1].clip, CardClip(startMs: 12_000))
        XCTAssertEqual(edited.cards[1].difficulty, 3)
        XCTAssertEqual(edited.cards[1].relatedTo, RelatedCard(cardId: first, relation: .coverOf))
        XCTAssertEqual(edited.cards[0], deck.cards[0])
        // Clearing again keeps version 2.
        XCTAssertEqual(try edited.updatingGameFields(clip: nil, difficulty: nil, relatedTo: nil, forCardID: second).schemaVersion, 2)
        XCTAssertThrowsError(try deck.updatingGameFields(clip: nil, difficulty: 6, relatedTo: nil, forCardID: first))
        XCTAssertThrowsError(try deck.updatingGameFields(clip: nil, difficulty: nil, relatedTo: RelatedCard(cardId: first, relation: .coverOf), forCardID: first))
        XCTAssertThrowsError(try deck.updatingGameFields(clip: nil, difficulty: 1, relatedTo: nil, forCardID: "missing"))
    }

    func testDefaultClipStartEdits() throws {
        let deck = try decode(demo())
        XCTAssertEqual(try deck.updatingDefaultClipStart(nil), deck)
        let edited = try deck.updatingDefaultClipStart(15_000)
        XCTAssertEqual(edited.schemaVersion, 2)
        XCTAssertEqual(edited.defaultClipStartMs, 15_000)
        XCTAssertThrowsError(try deck.updatingDefaultClipStart(3_600_001))
    }

    func testVersion2Ranges() throws {
        let base = try version2()
        func rejects(_ change: (inout [String: Any], inout [[String: Any]]) -> Void, line: UInt = #line) throws {
            var object = base
            var cards = try XCTUnwrap(object["cards"] as? [[String: Any]])
            change(&object, &cards)
            object["cards"] = cards
            XCTAssertThrowsError(try decode(object), line: line)
        }
        try rejects { object, _ in object["defaultClipStartMs"] = -1 }
        try rejects { object, _ in object["defaultClipStartMs"] = 3_600_001 }
        try rejects { object, _ in object["defaultClipStartMs"] = 1.5 }
        try rejects { _, cards in cards[0]["clip"] = ["startMs": 3_600_001] }
        try rejects { _, cards in cards[0]["clip"] = ["startMs": 0, "endMs": 5] }
        try rejects { _, cards in cards[0]["clip"] = [String: Any]() }
        try rejects { _, cards in cards[0]["difficulty"] = 0 }
        try rejects { _, cards in cards[0]["difficulty"] = 6 }
        try rejects { _, cards in cards[1]["relatedTo"] = ["cardId": cards[1]["id"]!, "relation": "coverOf"] }
        try rejects { _, cards in cards[1]["relatedTo"] = ["cardId": "missing", "relation": "coverOf"] }
        try rejects { _, cards in cards[1]["relatedTo"] = ["cardId": cards[0]["id"]!, "relation": "sampleOf"] }
        try rejects { _, cards in cards[1]["relatedTo"] = ["cardId": cards[0]["id"]!, "relation": "coverOf", "note": "x"] }
        try rejects { _, cards in cards[0]["unknown"] = 1 }
        var version3 = base
        version3["schemaVersion"] = 3
        XCTAssertThrowsError(try decode(version3))
    }
}
