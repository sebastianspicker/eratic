import Foundation
import XCTest
@testable import EraticCore

/// Runners for the game-rules.md case files. Each skips while its file does not exist.
final class GameContractCaseTests: XCTestCase {
    /// Named arguments with typed access; a missing or mistyped argument is a harness error.
    private struct Args {
        let name: String
        let values: [String: Any]

        func raw(_ key: String) throws -> Any {
            guard let value = values[key] else { throw CaseError("\(name): missing argument \(key)") }
            return value
        }
        func has(_ key: String) -> Bool { values[key] != nil }
        func int(_ key: String) throws -> Int {
            guard let value = SessionCodec.integerValue(try raw(key)) else { throw CaseError("\(name): argument \(key) is not an integer") }
            return value
        }
        func optionalInt(_ key: String) throws -> Int? { has(key) ? try int(key) : nil }
        func seed(_ key: String = "seed") throws -> UInt32 {
            guard let value = UInt32(exactly: try int(key)) else { throw CaseError("\(name): \(key) is not a uint32") }
            return value
        }
        func string(_ key: String) throws -> String {
            guard let value = try raw(key) as? String else { throw CaseError("\(name): argument \(key) is not a string") }
            return value
        }
        func bool(_ key: String) throws -> Bool {
            guard let value = try raw(key) as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw CaseError("\(name): argument \(key) is not a boolean") }
            return value.boolValue
        }
        func ints(_ key: String) throws -> [Int] {
            guard let list = try raw(key) as? [Any] else { throw CaseError("\(name): argument \(key) is not a list") }
            return try list.map { item in
                guard let value = SessionCodec.integerValue(item) else { throw CaseError("\(name): argument \(key) holds a non-integer") }
                return value
            }
        }
        func strings(_ key: String) throws -> [String] {
            guard let list = try raw(key) as? [String] else { throw CaseError("\(name): argument \(key) is not a list of strings") }
            return list
        }
        func objects(_ key: String) throws -> [[String: Any]] {
            guard let list = try raw(key) as? [[String: Any]] else { throw CaseError("\(name): argument \(key) is not a list of objects") }
            return list
        }
    }

    /// Calls the primitive named `fn`; rule errors propagate, harness problems are `CaseError`s.
    private func call(_ fn: String, _ args: Args) throws -> Any {
        let name = args.name
        switch fn {
        case "mulberry32":
            var rng = Mulberry32(seed: try args.seed())
            return (0..<(try args.int("count"))).map { _ in Int(rng.next()) }
        case "fnv1a32": return Int(GameRandom.fnv1a32(try args.string("text")))
        case "deriveSeed": return Int(GameRandom.deriveSeed(try args.seed(), try args.string("salt")))
        case "shuffle":
            guard let items = try args.raw("items") as? [Any] else { throw CaseError("\(name): items is not a list") }
            return GameRandom.shuffle(items, seed: try args.seed())
        case "compareCodePoints":
            let (a, b) = (try args.string("a"), try args.string("b"))
            return GameRandom.codePointPrecedes(a, b) ? -1 : GameRandom.codePointPrecedes(b, a) ? 1 : 0
        case "drawOrder": return GameRandom.drawOrder(try args.strings("cardIds"), seed: try args.seed())
        case "pickAnchors":
            let cards = try args.objects("cards").map { card -> AnchorCandidate in
                guard let id = card["id"] as? String, let year = card["year"].flatMap(SessionCodec.integerValue) else { throw CaseError("\(name): card needs id and year") }
                return AnchorCandidate(id: id, year: year)
            }
            guard let kind = AnchorKind(rawValue: try args.string("kind")) else { throw CaseError("\(name): unknown kind") }
            return try GameRandom.pickAnchors(cards, kind: kind, seed: try args.seed(), count: try args.int("count"), year: try args.optionalInt("year"))
        case "dailySelection":
            return GameRandom.dailySelection(try args.strings("cardIds"), date: try args.string("date"), deckId: try args.string("deckId"))
        case "isValidDate": return CivilDate.isValid(try args.string("date"))
        case "previousDay":
            guard let day = CivilDate.previousDay(try args.string("date")) else { throw GameRuleError("No previous day.") }
            return day
        case "dailyStreak":
            var previous: DailyStreakRecord?
            if args.has("previous") {
                guard let object = try args.raw("previous") as? [String: Any], let lastDate = object["lastDate"] as? String,
                      let streak = object["streak"].flatMap(SessionCodec.integerValue) else { throw CaseError("\(name): previous needs lastDate and streak") }
                previous = DailyStreakRecord(lastDate: lastDate, streak: streak)
            }
            return try Scoring.dailyStreak(previous: previous, date: try args.string("date"))
        case "dailyMaxScore": return Scoring.dailyMaxScore(count: try args.int(args.has("n") ? "n" : "count"))
        case "dailyShareText":
            return try Scoring.dailyShareText(date: try args.string("date"), score: try args.int("score"), maxScore: try args.int("maxScore"), eraIds: try args.strings("eraIds"))
        case "eraOf": return EraBoundaries.eraOf(try args.int("year"))
        case "eraIndex":
            guard let index = EraBoundaries.eraIndex(try args.string("id")) else { throw GameRuleError("Unknown era.") }
            return index
        case "eraName":
            guard let eraName = EraBoundaries.name(of: try args.string("id")) else { throw GameRuleError("Unknown era.") }
            return eraName
        case "isAdjacent":
            let (a, b) = (try args.string("a"), try args.string("b"))
            guard EraBoundaries.eraIndex(a) != nil, EraBoundaries.eraIndex(b) != nil else { throw GameRuleError("Unknown era.") }
            return EraBoundaries.areAdjacent(a, b)
        case "placementCorrect": return try Scoring.placementCorrect(years: try args.ints("years"), slot: try args.int("slot"), year: try args.int("year"))
        case "insertionIndex": return Scoring.insertionIndex(years: try args.ints("years"), year: try args.int("year"))
        case "distance": return Scoring.distance(try args.int("a"), try args.int("b"))
        case "bullseyePoints": return Scoring.bullseyePoints(guess: try args.int("guess"), answer: try args.int("answer"))
        case "eraSortPoints": return try Scoring.eraSortPoints(guessEra: try args.string("guessEra"), answerYear: try args.int("answerYear"), kids: try args.bool("kids"))
        case "ladderPoints": return try Scoring.ladderPoints(stepIndex: try args.int("stepIndex"), titleOK: try args.bool("titleOK"), artistOK: try args.bool("artistOK"))
        case "ladderYearPoints": return Scoring.ladderYearPoints(guess: try args.int("guess"), answer: try args.int("answer"))
        case "ladderYearBonus": return Scoring.ladderYearBonus(guess: try args.int("guess"), answer: try args.int("answer"))
        case "higherLowerCorrect":
            guard let call = HigherLowerCall(rawValue: try args.string("call")) else { throw GameRuleError("Unknown call.") }
            return Scoring.higherLowerCorrect(refYear: try args.int("refYear"), year: try args.int("year"), call: call)
        case "lineupPoints":
            guard let raw = try args.raw("years") as? [String: Any] else { throw CaseError("\(name): years is not an object") }
            var years = [String: Int]()
            for (id, value) in raw {
                guard let year = SessionCodec.integerValue(value) else { throw CaseError("\(name): years holds a non-integer") }
                years[id] = year
            }
            return try Scoring.lineupPoints(order: try args.strings("order"), years: years)
        case "imposterPoints":
            return Scoring.imposterPoints(pickedOriginal: try args.bool("pickedOriginal"), yearGuess: try args.optionalInt("yearGuess"), originalYear: try args.int("originalYear"))
        case "nameItAward": return Scoring.nameItAward(titleOK: try args.bool("titleOK"), artistOK: try args.bool("artistOK"))
        case "imposterPairs":
            let cards = try args.objects("cards").map { card -> (id: String, relatedTo: RelatedCard?) in
                guard let id = card["id"] as? String else { throw CaseError("\(name): card needs an id") }
                guard let related = card["relatedTo"] else { return (id, nil) }
                guard let object = related as? [String: Any], let target = object["cardId"] as? String,
                      let relation = (object["relation"] as? String).flatMap(Relation.init(rawValue:)) else { throw CaseError("\(name): invalid relatedTo") }
                return (id, RelatedCard(cardId: target, relation: relation))
            }
            return try GameRandom.imposterPairs(cards, seed: try args.seed()).map { ["a": $0.a, "b": $0.b, "original": $0.original] }
        case "eraticCardURL":
            return ScanRules.eraticCardURL(host: try args.string("host"), deckId: try args.string("deckId"), cardId: try args.string("cardId")) ?? NSNull()
        default:
            throw CaseError("\(name): unknown fn \(fn)")
        }
    }

    func testGamePrimitiveCases() throws {
        let cases = try ContractFixtures.optionalCases("cases/game-primitives.json")
        XCTAssertGreaterThan(cases.count, 0)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let fn = try XCTUnwrap(item["fn"] as? String, name)
            let args = Args(name: name, values: try XCTUnwrap(item["args"] as? [String: Any], "\(name): args must be an object"))
            let expectsError = item["error"] as? Bool == true
            do {
                let result = try call(fn, args)
                if expectsError {
                    XCTFail("\(name): expected an error, got \(canonicalJSON(result))")
                } else {
                    XCTAssertEqual(canonicalJSON(result), canonicalJSON(item["expected"]), name)
                }
            } catch let error as CaseError {
                XCTFail(error.description)
            } catch {
                if !expectsError { XCTFail("\(name): unexpected error \(error)") }
            }
        }
    }

    func testGameReplayCases() throws {
        let cases = try ContractFixtures.optionalCases("cases/game-replay.json")
        XCTAssertGreaterThan(cases.count, 0)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let expect = try XCTUnwrap(item["expect"] as? [String: Any], name)
            let rawSession = try XCTUnwrap(item["session"], name)
            if let error = expect["error"] as? [String: Any] {
                let at = try XCTUnwrap(error["at"].flatMap(SessionCodec.integerValue), "\(name): error.at")
                do {
                    let state = try GameEngine.replay(SessionCodec.parse(rawSession))
                    XCTFail("\(name): expected rejection at \(at), got \(canonicalJSON(GameEngine.summary(of: state)))")
                } catch let error as GameError {
                    XCTAssertEqual(error.actionIndex, at, "\(name): \(error.message)")
                } catch {
                    XCTFail("\(name): expected a rejection at \(at), got \(error)")
                }
            } else {
                do {
                    let state = try GameEngine.replay(SessionCodec.parse(rawSession))
                    assertPartialEqual(GameEngine.summary(of: state), expect, name)
                } catch {
                    XCTFail("\(name): expected a valid replay, got \(error)")
                }
            }
        }
    }

    func testSessionFileCases() throws {
        let cases = try ContractFixtures.optionalCases("cases/session-files.json")
        XCTAssertGreaterThan(cases.count, 0)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let expected = try XCTUnwrap(item["valid"] as? Bool, name)
            XCTAssertEqual(["session", "json", "base64"].filter { item[$0] != nil }.count, 1, "\(name): needs exactly one of session, json, base64")
            let data: Data
            if let json = item["json"] as? String {
                var bytes = Data(json.utf8)
                // `padToBytes` appends ASCII spaces up to an exact size, to test the 2 MiB limit.
                if let size = item["padToBytes"] as? Int, size > bytes.count {
                    bytes.append(Data(repeating: 0x20, count: size - bytes.count))
                }
                data = bytes
            } else if let base64 = item["base64"] as? String {
                data = try XCTUnwrap(Data(base64Encoded: base64), "\(name): invalid base64")
            } else {
                data = try JSONSerialization.data(withJSONObject: XCTUnwrap(item["session"], name))
            }
            if expected {
                do {
                    let session = try SessionCodec.decode(data)
                    XCTAssertEqual(try SessionCodec.decode(SessionCodec.encode(session)), session, name)
                } catch { XCTFail("\(name): expected valid, got \(error)") }
            } else {
                XCTAssertThrowsError(try SessionCodec.decode(data), name)
            }
        }
    }

    func testProviderTrackCases() throws {
        let cases = try ContractFixtures.optionalCases("cases/provider-tracks.json")
        XCTAssertGreaterThan(cases.count, 0)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let input = try XCTUnwrap(item["input"] as? [String: Any], name)
            let track: ProviderTrack?
            if let url = input["url"] as? String {
                track = ScanRules.providerTrack(url)
            } else if let link = input["link"] {
                track = ScanRules.linkTrack(try JSONDecoder().decode(ProviderLink.self, from: JSONSerialization.data(withJSONObject: link)))
            } else {
                XCTFail("\(name): input needs url or link")
                continue
            }
            let expected = item["expected"].flatMap { $0 is NSNull ? nil : $0 }
            XCTAssertEqual(canonicalJSON(track?.jsonObject), canonicalJSON(expected), name)
        }
    }

    func testScanResolutionCases() throws {
        let cases = try ContractFixtures.optionalCases("cases/scan-resolution.json")
        XCTAssertGreaterThan(cases.count, 0)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let deck = try DeckCodec.decode(JSONSerialization.data(withJSONObject: XCTUnwrap(item["deck"], name)))
            let hosts = try XCTUnwrap(item["hosts"] as? [String], name)
            let payload = try XCTUnwrap(item["payload"] as? String, name)
            let result = ScanRules.resolveScan(payload: payload, deck: deck, hosts: hosts)
            XCTAssertEqual(canonicalJSON(result.jsonObject), canonicalJSON(item["expected"]), name)
        }
    }
}
