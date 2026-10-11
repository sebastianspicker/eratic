import Foundation
import XCTest
@testable import EraticCore

final class ContractCaseTests: XCTestCase {
    func testDeckValidationCases() throws {
        let cases = try ContractFixtures.cases("cases/deck-validation.json")
        XCTAssertGreaterThan(cases.count, 0, "deck-validation.json has no cases")
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let expected = try XCTUnwrap(item["valid"] as? Bool, name)
            XCTAssertEqual(["deck", "json", "base64"].filter { item[$0] != nil }.count, 1, "\(name): needs exactly one of deck, json, base64")
            let data: Data
            if let json = item["json"] as? String {
                data = Data(json.utf8)
            } else if let base64 = item["base64"] as? String {
                data = try XCTUnwrap(Data(base64Encoded: base64), "\(name): invalid base64")
            } else {
                data = try JSONSerialization.data(withJSONObject: XCTUnwrap(item["deck"], name))
            }
            if expected {
                do {
                    let deck = try DeckCodec.decode(data)
                    XCTAssertEqual(try DeckCodec.decode(DeckCodec.encode(deck)), deck, name)
                } catch { XCTFail("\(name): expected valid, got \(error)") }
            } else {
                XCTAssertThrowsError(try DeckCodec.decode(data), name)
            }
        }
    }

    func testCardURLCases() throws {
        let cases = try ContractFixtures.cases("cases/card-urls.json")
        XCTAssertGreaterThan(cases.count, 0, "card-urls.json has no cases")
        let demo = try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("demo-deck.json")) as? [String: Any])
        for item in cases {
            let url = try XCTUnwrap(item["url"] as? String)
            let role = try XCTUnwrap(item["role"] as? String, url)
            let expected = try XCTUnwrap(item["valid"] as? Bool, url)
            var object = demo
            var cards = try XCTUnwrap(object["cards"] as? [[String: Any]], url)
            switch role {
            case "providerLink":
                var links = try XCTUnwrap(cards[0]["links"] as? [[String: Any]], url)
                links[0]["url"] = url
                cards[0]["links"] = links
            case "officialCard":
                cards[0]["officialCard"] = ["url": url]
            default:
                XCTFail("Unknown role \(role) for \(url)")
                continue
            }
            object["cards"] = cards
            let data = try JSONSerialization.data(withJSONObject: object)
            if expected {
                do { _ = try DeckCodec.decode(data) } catch { XCTFail("\(role) \(url): expected valid, got \(error)") }
            } else {
                XCTAssertThrowsError(try DeckCodec.decode(data), "\(role) \(url)")
            }
        }
    }

    func testQRRouteCases() throws {
        let cases = try ContractFixtures.cases("cases/qr-routes.json")
        XCTAssertGreaterThan(cases.count, 0, "qr-routes.json has no cases")
        let demo = try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("demo-deck.json")) as? [String: Any])
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let modeName = try XCTUnwrap(item["mode"] as? String, name)
            let mode = try XCTUnwrap(QRMode(rawValue: modeName), "\(name): unknown mode \(modeName)")
            let linkIndex = try XCTUnwrap(item["linkIndex"] as? Int, name)
            var object = demo
            object["cards"] = [try XCTUnwrap(item["card"], name)]
            let deck = try DeckCodec.decode(JSONSerialization.data(withJSONObject: object))
            let expected = item["expected"] as? String
            var eratic: EraticCardRoute?
            if let route = item["eratic"] as? [String: Any] {
                eratic = EraticCardRoute(host: try XCTUnwrap(route["host"] as? String, name), deckId: try XCTUnwrap(route["deckId"] as? String, name))
            }
            XCTAssertEqual(QRRoute.payload(for: deck.cards[0], mode: mode, linkIndex: linkIndex, eratic: eratic), expected, name)
        }
    }
}
