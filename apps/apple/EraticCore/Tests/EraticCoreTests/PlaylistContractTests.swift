import Foundation
import XCTest
@testable import EraticCore

/// Runs contract/cases/playlist-candidates.json, which the web core's tests run too.
final class PlaylistContractTests: XCTestCase {
    private func root() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("cases/playlist-candidates.json")) as? [String: Any])
    }

    private func group(_ root: [String: Any], _ name: String) throws -> [[String: Any]] {
        let cases = try XCTUnwrap(root[name] as? [[String: Any]], name)
        XCTAssertGreaterThan(cases.count, 0, "\(name) has no cases")
        return cases
    }

    /// Decodes without validating, since decks here may have no cards.
    private func deck(_ root: [String: Any], _ key: String, _ name: String) throws -> Deck {
        let decks = try XCTUnwrap(root["decks"] as? [String: Any], name)
        let raw = try XCTUnwrap(decks[key], "\(name): unknown deck \(key)")
        return try JSONDecoder().decode(Deck.self, from: JSONSerialization.data(withJSONObject: raw))
    }

    private func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    /// A rejected page throws the `DeckError` the implementation uses, with its "Invalid playlist page" message.
    private func assertRejected(_ name: String, _ body: () throws -> Void) {
        XCTAssertThrowsError(try body(), name) { error in
            guard let error = error as? DeckError else { return XCTFail("\(name): expected DeckError, got \(error)") }
            XCTAssertTrue(error.message.hasPrefix("Invalid playlist page: "), "\(name): \(error.message)")
        }
    }

    func testPlaylistReferences() throws {
        for item in try group(root(), "references") {
            let name = try XCTUnwrap(item["name"] as? String)
            let input = try XCTUnwrap(item["input"] as? String, name)
            var actual: Any = NSNull()
            if let reference = PlaylistRules.playlistReference(input) {
                var object: [String: Any] = ["provider": reference.provider.rawValue, "id": reference.id]
                if let storefront = reference.storefront { object["storefront"] = storefront }
                actual = object
            }
            XCTAssertEqual(canonicalJSON(actual), canonicalJSON(item["expected"]), name)
        }
    }

    func testPlaylistPages() throws {
        for item in try group(root(), "pages") {
            let name = try XCTUnwrap(item["name"] as? String)
            let provider = try XCTUnwrap(CandidateProvider(rawValue: item["provider"] as? String ?? ""), name)
            let start = try XCTUnwrap(item["start"] as? Int, name)
            let expected = try XCTUnwrap(item["expected"] as? [String: Any], name)
            // A case gives the decoded `page`, or the exact page text as `json`, which `decodePage` reads first.
            let run: () throws -> (candidates: [Candidate], next: String?) = {
                let page: ProviderJSON
                if let text = item["json"] as? String {
                    page = try PlaylistRules.decodePage(Data(text.utf8))
                } else {
                    page = try JSONDecoder().decode(ProviderJSON.self, from: JSONSerialization.data(withJSONObject: XCTUnwrap(item["page"], name), options: .fragmentsAllowed))
                }
                return try PlaylistRules.normalizePage(provider: provider, page: page, start: start, storefront: item["storefront"] as? String)
            }
            if expected["error"] != nil {
                assertRejected(name) { _ = try run() }
                continue
            }
            do {
                let result = try run()
                XCTAssertEqual(canonicalJSON(try json(result.candidates)), canonicalJSON(expected["candidates"]), name)
                XCTAssertEqual(canonicalJSON(result.next.map { $0 as Any } ?? NSNull()), canonicalJSON(expected["next"]), name)
            } catch { XCTFail("\(name): \(error)") }
        }
    }

    func testPlaylistReview() throws {
        let root = try root()
        for item in try group(root, "review") {
            let name = try XCTUnwrap(item["name"] as? String)
            let candidates = try JSONDecoder().decode([Candidate].self, from: JSONSerialization.data(withJSONObject: XCTUnwrap(item["candidates"], name)))
            let deck = try deck(root, XCTUnwrap(item["deck"] as? String, name), name)
            XCTAssertEqual(canonicalJSON(try json(PlaylistRules.review(candidates, deck: deck))), canonicalJSON(item["expected"]), name)
        }
    }

    func testPlaylistPromotion() throws {
        let root = try root()
        for item in try group(root, "promotion") {
            let name = try XCTUnwrap(item["name"] as? String)
            let before = try deck(root, XCTUnwrap(item["deck"] as? String, name), name)
            let candidate = try JSONDecoder().decode(Candidate.self, from: JSONSerialization.data(withJSONObject: XCTUnwrap(item["candidate"], name)))
            let raw = try XCTUnwrap(item["decision"] as? [String: Any], name)
            let expected = try XCTUnwrap(item["expected"] as? [String: Any], name)
            // A year that is not an integer cannot be a `GameYear`; the strict decoder refuses it, as it does for a deck.
            // Only that case may be skipped here.
            guard let gameYear = try? JSONDecoder().decode(GameYear.self, from: JSONSerialization.data(withJSONObject: XCTUnwrap(raw["gameYear"], name))) else {
                XCTAssertEqual(name, "game year not an integer", "gameYear failed to decode in a case that expects it to")
                XCTAssertEqual(expected["error"] as? String, PromotionError.invalid.rawValue, name)
                continue
            }
            func override(_ key: String) throws -> String? {
                guard let value = raw[key] else { return nil }
                return try XCTUnwrap(value as? String, "\(name): \(key) must be a string")
            }
            let decision = PromotionDecision(gameYear: gameYear, title: try override("title"), artist: try override("artist"))
            let result = PlaylistRules.promote(candidate, into: before, decision: decision)
            if let error = expected["error"] as? String {
                guard case let .failure(actual) = result else { XCTFail("\(name): expected error \(error)"); continue }
                XCTAssertEqual(actual.rawValue, error, name)
                continue
            }
            guard case let .success(after) = result else { XCTFail("\(name): expected success, got \(result)"); continue }
            XCTAssertEqual(after.cards.count, expected["cardCount"] as? Int, name)
            XCTAssertEqual(Array(after.cards.dropLast()), before.cards, name)
            XCTAssertEqual(canonicalJSON(try json(after.cards.last)), canonicalJSON(expected["card"]), name)
            var rest = after
            rest.cards = before.cards
            XCTAssertEqual(rest, before, name)
        }
    }
}
