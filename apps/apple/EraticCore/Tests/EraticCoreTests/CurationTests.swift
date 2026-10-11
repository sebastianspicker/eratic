import Foundation
import XCTest
@testable import EraticCore

final class CurationTests: XCTestCase {
    private func deckWithMetadata() throws -> Deck {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("demo-deck.json")) as? [String: Any])
        var cards = try XCTUnwrap(object["cards"] as? [[String: Any]])
        cards[0]["officialCard"] = ["url": "https://www.hitstergame.com/se/aaaa0034/00001", "notes": "Supplied test mapping; not playback-verified."]
        var links = try XCTUnwrap(cards[0]["links"] as? [[String: Any]])
        links[0]["releaseDate"] = "2024-06-01"
        cards[0]["links"] = links
        object["cards"] = cards
        return try DeckCodec.decode(JSONSerialization.data(withJSONObject: object))
    }

    func testCuratedYearDoesNotAlterProviderMetadataOrIdentity() throws {
        let deck = try deckWithMetadata()
        let original = deck.cards[0]
        let updated = try deck.updatingGameYear(GameYear(value: 1985, source: "Curated evidence", note: "Checked"), forCardID: original.id)
        let reimported = try DeckCodec.decode(DeckCodec.encode(updated))
        let card = reimported.cards[0]
        XCTAssertEqual(card.id, original.id)
        XCTAssertEqual(card.links, original.links)
        XCTAssertEqual(card.recordingVersion, original.recordingVersion)
        XCTAssertEqual(card.officialCard, original.officialCard)
        XCTAssertEqual(card.gameYear, GameYear(value: 1985, source: "Curated evidence", note: "Checked"))
        XCTAssertEqual(QRRoute.payload(for: card), original.officialCard?.url)
        XCTAssertEqual(reimported.cards.dropFirst(), deck.cards.dropFirst())
    }

    func testInvalidYearOrSourceThrowsAndLeavesDeckUnchanged() throws {
        let deck = try deckWithMetadata()
        let id = deck.cards[0].id
        for year in [GameYear(value: 1849, source: "Source"), GameYear(value: 2101, source: "Source"),
                     GameYear(value: 1985, source: " \u{3000}\u{FEFF}"), GameYear(value: 1985, source: ""),
                     GameYear(value: 1985, source: String(repeating: "a", count: 501)),
                     GameYear(value: 1985, source: "Source", note: "\n")] {
            XCTAssertThrowsError(try deck.updatingGameYear(year, forCardID: id), "\(year)")
        }
    }

    func testUnknownCardIDThrows() throws {
        let deck = try deckWithMetadata()
        XCTAssertThrowsError(try deck.updatingGameYear(GameYear(value: 1985, source: "Source"), forCardID: "missing")) { error in
            XCTAssertEqual((error as? DeckError)?.message, "Unknown card ID: missing")
        }
    }
}
