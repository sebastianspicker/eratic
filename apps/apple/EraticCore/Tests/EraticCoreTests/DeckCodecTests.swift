import Foundation
import XCTest
@testable import EraticCore

final class DeckCodecTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        try ContractFixtures.data(name)
    }

    func testImportSizeLimit() {
        XCTAssertThrowsError(try DeckCodec.decode(Data(repeating: 32, count: DeckCodec.maximumBytes + 1)))
    }

    func testCardCountLimit() throws {
        let demo = try DeckCodec.decode(fixture("demo-deck.json"))
        func deck(cards count: Int) throws -> Data {
            let cards = (0..<count).map { index in
                var copy = demo.cards[0]
                copy.id = String(format: "card-%04d", index)
                return copy
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.withoutEscapingSlashes]
            return try encoder.encode(Deck(id: "limit", title: "Limit", cards: cards))
        }
        XCTAssertEqual(try DeckCodec.decode(deck(cards: 2000)).cards.count, 2000)
        XCTAssertThrowsError(try DeckCodec.decode(deck(cards: 2001)))
    }

    func testLargeCompactImportRemainsExportable() throws {
        let link = ProviderLink(
            provider: .other,
            url: "https://example.com/" + String(repeating: "a", count: 1800),
            id: String(repeating: "b", count: 500),
            releaseDate: String(repeating: "c", count: 500)
        )
        let card = SongCard(id: "card-0000", title: "Sample", artist: "Sample",
                            gameYear: GameYear(value: 1984, source: "Test"), links: [link, link])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let count = (DeckCodec.maximumBytes - 4096) / (try encoder.encode(card).count + 1)
        let cards = (0..<count).map { index in
            var copy = card
            copy.id = String(format: "card-%04d", index)
            return copy
        }
        let deck = Deck(id: "large", title: "Large fixture", cards: cards)
        let compact = try encoder.encode(deck)
        XCTAssertLessThanOrEqual(compact.count, DeckCodec.maximumBytes)
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        XCTAssertGreaterThan(try encoder.encode(deck).count, DeckCodec.maximumBytes)
        let imported = try DeckCodec.decode(compact)
        let exported = try DeckCodec.encode(imported)
        XCTAssertLessThanOrEqual(exported.count, DeckCodec.maximumBytes)
        XCTAssertEqual(try DeckCodec.decode(exported), imported)
    }

    func testStableIdentifierRejectsFinalLineBreak() throws {
        var deck = try DeckCodec.decode(fixture("demo-deck.json"))
        deck.cards[0].id += "\n"
        XCTAssertThrowsError(try DeckCodec.encode(deck))
    }
}
