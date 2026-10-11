import Foundation
import XCTest
@testable import EraticCore

/// Expected values were computed by an independent Python implementation of game-rules.md section 1.
final class PrimitivesTests: XCTestCase {
    func testErasMatchContractFile() throws {
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: ContractFixtures.data("eras.json")) as? [String: Any])
        let eras = try XCTUnwrap(root["eras"] as? [[String: Any]])
        let decoded = eras.map { era in
            EraBoundary(id: era["id"] as? String ?? "", name: era["name"] as? String ?? "",
                        from: era["from"] as? Int, to: era["to"] as? Int)
        }
        XCTAssertEqual(decoded, EraBoundaries.all)
    }

    func testEraLookup() {
        for (year, id) in [(1000, "shellac"), (1949, "shellac"), (1950, "jukebox"), (1984, "neon"), (2019, "pastel"), (2020, "now"), (9999, "now")] {
            XCTAssertEqual(EraBoundaries.eraOf(year), id, "\(year)")
        }
        XCTAssertEqual(EraBoundaries.eraIndex("now"), 8)
        XCTAssertNil(EraBoundaries.eraIndex("vinyl"))
        XCTAssertTrue(EraBoundaries.areAdjacent("shellac", "jukebox"))
        XCTAssertFalse(EraBoundaries.areAdjacent("shellac", "now"))
        XCTAssertFalse(EraBoundaries.areAdjacent("neon", "neon"))
    }

    func testHashAndGenerator() {
        XCTAssertEqual(GameRandom.fnv1a32(""), 2166136261)
        XCTAssertEqual(GameRandom.fnv1a32("a"), 3826002220)
        XCTAssertEqual(GameRandom.fnv1a32("Eratic"), 1307606615)
        XCTAssertEqual(GameRandom.fnv1a32("é"), 513665217)
        XCTAssertEqual(GameRandom.deriveSeed(42, "draw"), 4279762793)
        XCTAssertEqual(GameRandom.deriveSeed(4294967295, "anchor"), 2293895369)
        var rng = Mulberry32(seed: 42)
        XCTAssertEqual([rng.next(), rng.next(), rng.next()], [2581720956, 1925393290, 3661312704])
        rng = Mulberry32(seed: 0)
        XCTAssertEqual([rng.next(), rng.next()], [1144304738, 1416247])
    }

    func testShuffleAndOrders() {
        XCTAssertEqual(GameRandom.shuffle([1, 2, 3, 4, 5], seed: 7), [2, 1, 4, 5, 3])
        XCTAssertEqual(GameRandom.shuffle([Int](), seed: 7), [])
        // "é" (U+00E9) and "e" are different IDs; code-point order puts "é" last.
        XCTAssertEqual(GameRandom.drawOrder(["c3", "c1", "c2", "c1", "c4", "é", "e"], seed: 42), ["c2", "e", "c1", "c3", "é", "c4"])
        XCTAssertEqual(GameRandom.dailySelection(["a", "b", "c", "d", "e", "f", "g"], date: "2026-10-12", deckId: "demo-deck"), ["f", "d", "c", "a", "b"])
        XCTAssertEqual(GameRandom.dailySelection(["g", "f", "e", "d", "c", "b", "a"], date: "2026-10-12", deckId: "demo-deck"), ["f", "d", "c", "a", "b"])
        XCTAssertEqual(GameRandom.dailySelection(["b", "a"], date: "2026-10-12", deckId: "demo-deck").count, 2)
    }

    func testCodePointOrderIgnoresCanonicalEquivalence() {
        XCTAssertTrue(GameRandom.codePointPrecedes("B", "a"))
        XCTAssertTrue(GameRandom.codePointPrecedes("\u{FF5E}", "\u{1F3B5}"))
        XCTAssertTrue(GameRandom.codePointPrecedes("e\u{301}", "\u{E9}"))
        XCTAssertEqual(GameRandom.drawOrder(["\u{E9}", "e\u{301}"], seed: 1).count, 2)
    }

    func testAnchorPicks() throws {
        let cards = [("a", 1950), ("b", 1960), ("c", 1970), ("d", 1980), ("e", 1990), ("f", 2000), ("g", 2010), ("h", 2020),
                     ("i", 1984), ("j", 1985), ("k", 1999), ("l", 1955)].map { AnchorCandidate(id: $0.0, year: $0.1) }
        XCTAssertEqual(try GameRandom.pickAnchors(cards, kind: .beginning, seed: 42, count: 3), ["a", "l", "b"])
        XCTAssertEqual(try GameRandom.pickAnchors(cards, kind: .middle, seed: 42, count: 3), ["i", "j", "d"])
        XCTAssertEqual(try GameRandom.pickAnchors(cards, kind: .random, seed: 42, count: 3), ["b", "g", "k"])
        XCTAssertEqual(try GameRandom.pickAnchors(cards, kind: .custom, seed: 42, count: 2, year: 1983), ["i", "j"])
        XCTAssertThrowsError(try GameRandom.pickAnchors(cards, kind: .custom, seed: 42, count: 1))
        XCTAssertThrowsError(try GameRandom.pickAnchors(Array(cards.prefix(2)), kind: .random, seed: 42, count: 3))
    }

    func testImposterPairs() throws {
        let cards: [(id: String, relatedTo: RelatedCard?)] = [
            ("A", nil), ("B", RelatedCard(cardId: "A", relation: .coverOf)), ("C", RelatedCard(cardId: "B", relation: .coverOf)),
            ("D", RelatedCard(cardId: "E", relation: .originalOf)), ("E", nil), ("F", RelatedCard(cardId: "A", relation: .remasterOf)),
            ("G", RelatedCard(cardId: "H", relation: .originalOf)),
        ]
        XCTAssertEqual(try GameRandom.imposterPairs(cards, seed: 42), [
            ImposterPair(a: "A", b: "F", original: "A"), ImposterPair(a: "B", b: "A", original: "A"), ImposterPair(a: "E", b: "D", original: "D"),
        ])
    }

    func testScoring() throws {
        XCTAssertTrue(try Scoring.placementCorrect(years: [1960, 1970, 1970, 1980], slot: 1, year: 1970))
        XCTAssertTrue(try Scoring.placementCorrect(years: [1960, 1970, 1970, 1980], slot: 3, year: 1970))
        XCTAssertFalse(try Scoring.placementCorrect(years: [1960, 1970, 1970, 1980], slot: 0, year: 1970))
        XCTAssertTrue(try Scoring.placementCorrect(years: [], slot: 0, year: 1970))
        XCTAssertThrowsError(try Scoring.placementCorrect(years: [1960], slot: 2, year: 1970))
        XCTAssertEqual(Scoring.insertionIndex(years: [1960, 1970, 1970, 1980], year: 1970), 3)
        XCTAssertEqual([0, 1, 2, 3, 4, 5, 6, 10, 11].map { Scoring.bullseyePoints(guess: 1984 + $0, answer: 1984) }, [10, 7, 5, 5, 3, 3, 1, 1, 0])
        XCTAssertEqual(try Scoring.eraSortPoints(guessEra: "neon", answerYear: 1984, kids: false), 3)
        XCTAssertEqual(try Scoring.eraSortPoints(guessEra: "zine", answerYear: 1984, kids: false), 1)
        XCTAssertEqual(try Scoring.eraSortPoints(guessEra: "zine", answerYear: 1984, kids: true), 3)
        XCTAssertEqual(try Scoring.eraSortPoints(guessEra: "now", answerYear: 1984, kids: true), 0)
        XCTAssertThrowsError(try Scoring.eraSortPoints(guessEra: "vinyl", answerYear: 1984, kids: false))
        XCTAssertEqual(try Scoring.ladderPoints(stepIndex: 1, titleOK: true, artistOK: false), 4)
        XCTAssertEqual(try Scoring.ladderPoints(stepIndex: 4, titleOK: false, artistOK: true), 1)
        XCTAssertEqual(try Scoring.ladderPoints(stepIndex: 0, titleOK: false, artistOK: false), 0)
        XCTAssertThrowsError(try Scoring.ladderPoints(stepIndex: 5, titleOK: true, artistOK: true))
        XCTAssertEqual([1984, 1986, 1987, 1989, 1990].map { Scoring.ladderYearPoints(guess: $0, answer: 1984) }, [5, 3, 1, 1, 0])
        XCTAssertEqual([1984, 1982, 1987].map { Scoring.ladderYearBonus(guess: $0, answer: 1984) }, [3, 1, 0])
        XCTAssertTrue(Scoring.higherLowerCorrect(refYear: 1984, year: 1984, call: .later))
        XCTAssertFalse(Scoring.higherLowerCorrect(refYear: 1984, year: 1985, call: .earlier))
        let years = ["a": 1960, "b": 1970, "c": 1980, "d": 1990, "e": 2000]
        XCTAssertEqual(try Scoring.lineupPoints(order: ["a", "b", "c", "d"], years: years), 8)
        XCTAssertEqual(try Scoring.lineupPoints(order: ["a", "b", "c", "d", "e"], years: years), 12)
        XCTAssertEqual(try Scoring.lineupPoints(order: ["b", "a", "c", "d"], years: years), 5)
        XCTAssertEqual(try Scoring.lineupPoints(order: ["d", "c", "b", "a"], years: years), 0)
        XCTAssertThrowsError(try Scoring.lineupPoints(order: ["a", "z"], years: years))
        XCTAssertEqual(Scoring.imposterPoints(pickedOriginal: true, yearGuess: 1986, originalYear: 1984), 8)
        XCTAssertEqual(Scoring.imposterPoints(pickedOriginal: false, yearGuess: 1987, originalYear: 1984), 0)
        XCTAssertEqual(Scoring.imposterPoints(pickedOriginal: true, yearGuess: nil, originalYear: 1984), 5)
        XCTAssertTrue(Scoring.nameItAward(titleOK: true, artistOK: true))
        XCTAssertFalse(Scoring.nameItAward(titleOK: true, artistOK: false))
    }

    func testDailyHelpers() throws {
        XCTAssertEqual((0...5).map { Scoring.dailyMaxScore(count: $0) }, [0, 3, 6, 9, 19, 29])
        XCTAssertEqual(try Scoring.dailyStreak(previous: nil, date: "2026-10-11"), 1)
        XCTAssertEqual(try Scoring.dailyStreak(previous: DailyStreakRecord(lastDate: "2026-10-11", streak: 4), date: "2026-10-11"), 4)
        XCTAssertEqual(try Scoring.dailyStreak(previous: DailyStreakRecord(lastDate: "2024-02-29", streak: 4), date: "2024-03-01"), 5)
        XCTAssertEqual(try Scoring.dailyStreak(previous: DailyStreakRecord(lastDate: "2025-12-31", streak: 4), date: "2026-01-01"), 5)
        XCTAssertEqual(try Scoring.dailyStreak(previous: DailyStreakRecord(lastDate: "2026-10-09", streak: 4), date: "2026-10-11"), 1)
        XCTAssertThrowsError(try Scoring.dailyStreak(previous: nil, date: "2026-02-29"))
        XCTAssertTrue(CivilDate.isValid("2000-02-29"))
        XCTAssertFalse(CivilDate.isValid("1900-02-29"))
        XCTAssertFalse(CivilDate.isValid("2026-13-01"))
        XCTAssertFalse(CivilDate.isValid("2026-1-01"))
        XCTAssertFalse(CivilDate.isValid("２026-01-01"))
        XCTAssertEqual(CivilDate.previousDay("2026-03-01"), "2026-02-28")
        XCTAssertEqual(CivilDate.previousDay("0001-01-01"), "0000-12-31")
        XCTAssertNil(CivilDate.previousDay("0000-01-01"))
        XCTAssertEqual(try Scoring.previousDay("2024-03-01"), "2024-02-29")
        XCTAssertEqual(try Scoring.previousDay("2026-01-01"), "2025-12-31")
        XCTAssertNil(try Scoring.previousDay("0000-01-01"))
        XCTAssertThrowsError(try Scoring.previousDay("2026-02-29"))
        XCTAssertEqual(try Scoring.dailyShareText(date: "2026-10-11", score: 24, maxScore: 29, eraIds: ["neon", "zine", "now", "mod", "shellac"]),
                       "Eratic 2026-10-11 \u{B7} 24/29 \u{B7} Neon Zine Now Mod Shellac")
        XCTAssertThrowsError(try Scoring.dailyShareText(date: "2026-10-11", score: 1, maxScore: 3, eraIds: ["vinyl"]))
    }
}
