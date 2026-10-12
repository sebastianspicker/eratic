import Foundation

/// A Higher or Lower call.
public enum HigherLowerCall: String, CaseIterable, Sendable {
    case earlier, later
}

/// The stored Daily Eratic streak, `{lastDate, streak}`.
public struct DailyStreakRecord: Equatable, Sendable {
    public var lastDate: String
    public var streak: Int
    public init(lastDate: String, streak: Int) {
        self.lastDate = lastDate
        self.streak = streak
    }
}

/// The scoring primitives of game-rules.md section 3 and the Daily Eratic helpers of section 6.8.
public enum Scoring {
    /// `years` is non-decreasing; equal years are correct on either side.
    public static func placementCorrect(years: [Int], slot: Int, year: Int) throws -> Bool {
        guard (0...years.count).contains(slot) else { throw GameRuleError("slot must be 0–\(years.count).") }
        return (slot == 0 || years[slot - 1] <= year) && (slot == years.count || year <= years[slot])
    }

    /// The number of entries `≤ year`.
    public static func insertionIndex(years: [Int], year: Int) -> Int {
        years.filter { $0 <= year }.count
    }

    public static func distance(_ a: Int, _ b: Int) -> Int { abs(a - b) }

    public static func bullseyePoints(guess: Int, answer: Int) -> Int {
        switch distance(guess, answer) {
        case 0: return 10
        case 1: return 7
        case 2...3: return 5
        case 4...5: return 3
        case 6...10: return 1
        default: return 0
        }
    }

    public static func eraSortPoints(guessEra: String, answerYear: Int, kids: Bool) throws -> Int {
        guard EraBoundaries.eraIndex(guessEra) != nil else { throw GameRuleError("Unknown era: \(guessEra).") }
        let answer = EraBoundaries.eraOf(answerYear)
        if guessEra.utf8.elementsEqual(answer.utf8) { return 3 }
        if EraBoundaries.areAdjacent(guessEra, answer) { return kids ? 3 : 1 }
        return 0
    }

    static let ladderStepPoints = [10, 8, 6, 4, 2]

    public static func ladderPoints(stepIndex: Int, titleOK: Bool, artistOK: Bool) throws -> Int {
        guard ladderStepPoints.indices.contains(stepIndex) else { throw GameRuleError("stepIndex must be 0–4.") }
        let points = ladderStepPoints[stepIndex]
        switch (titleOK, artistOK) {
        case (true, true): return points
        case (false, false): return 0
        default: return points / 2
        }
    }

    public static func ladderYearPoints(guess: Int, answer: Int) -> Int {
        let d = distance(guess, answer)
        if d == 0 { return 5 }
        if d <= 2 { return 3 }
        return EraBoundaries.eraOf(guess) == EraBoundaries.eraOf(answer) ? 1 : 0
    }

    public static func ladderYearBonus(guess: Int, answer: Int) -> Int {
        let d = distance(guess, answer)
        return d == 0 ? 3 : d <= 2 ? 1 : 0
    }

    public static func higherLowerCorrect(refYear: Int, year: Int, call: HigherLowerCall) -> Bool {
        call == .earlier ? year <= refYear : year >= refYear
    }

    /// One point per ordered pair in year order, plus 2 when every pair scored.
    public static func lineupPoints(order: [String], years: [String: Int]) throws -> Int {
        // Card IDs match exactly: `[String: Int]` lookups would apply canonical equivalence.
        var exact = [[UInt8]: Int]()
        for (id, year) in years { exact[Array(id.utf8)] = year }
        let values = try order.map { id -> Int in
            guard let year = exact[Array(id.utf8)] else { throw GameRuleError("No year for card \(id).") }
            return year
        }
        var points = 0
        for i in values.indices {
            for j in values.indices where j > i && values[i] <= values[j] { points += 1 }
        }
        return points == lineupPairs(order.count) ? points + 2 : points
    }

    static func lineupPairs(_ count: Int) -> Int { count * (count - 1) / 2 }

    public static func imposterPoints(pickedOriginal: Bool, yearGuess: Int?, originalYear: Int) -> Int {
        (pickedOriginal ? 5 : 0) + (yearGuess.map { distance($0, originalYear) <= 2 ? 3 : 0 } ?? 0)
    }

    public static func nameItAward(titleOK: Bool, artistOK: Bool) -> Bool { titleOK && artistOK }

    /// Round `round` (from 1) of a Daily: rounds 1–3 are Era Sort, later rounds Bullseye. Throws below 1.
    public static func dailyRoundKind(_ round: Int) throws -> GameMode {
        guard round >= 1 else { throw GameRuleError("Invalid round: \(round).") }
        return round <= 3 ? .eraSort : .bullseye
    }

    /// `3 × min(3, n) + 10 × max(0, n − 3)`.
    public static func dailyMaxScore(count: Int) -> Int {
        3 * min(3, count) + 10 * max(0, count - 3)
    }

    /// Throws when either date is not a real `YYYY-MM-DD` calendar date.
    public static func dailyStreak(previous: DailyStreakRecord?, date: String) throws -> Int {
        guard CivilDate.isValid(date) else { throw GameRuleError("Invalid date: \(date).") }
        guard let previous else { return 1 }
        guard CivilDate.isValid(previous.lastDate) else { throw GameRuleError("Invalid date: \(previous.lastDate).") }
        if previous.lastDate == date { return previous.streak }
        if CivilDate.previousDay(date) == previous.lastDate { return previous.streak + 1 }
        return 1
    }

    /// The day before a `YYYY-MM-DD` date, or `nil` for 0000-01-01. Throws when the date is not a real calendar date.
    public static func previousDay(_ date: String) throws -> String? {
        guard CivilDate.isValid(date) else { throw GameRuleError("Invalid date: \(date).") }
        return CivilDate.previousDay(date)
    }

    /// `Eratic <date> · <score>/<maximum> · <era names>`, U+00B7 with a space on each side.
    public static func dailyShareText(date: String, score: Int, maxScore: Int, eraIds: [String]) throws -> String {
        let names = try eraIds.map { id -> String in
            guard let name = EraBoundaries.name(of: id) else { throw GameRuleError("Unknown era: \(id).") }
            return name
        }
        return "Eratic \(date) \u{B7} \(score)/\(maxScore) \u{B7} " + names.joined(separator: " ")
    }
}

/// Proleptic Gregorian `YYYY-MM-DD` dates in integer arithmetic; no `Date` or `Calendar`.
enum CivilDate {
    static func parse(_ text: String) -> (year: Int, month: Int, day: Int)? {
        let bytes = Array(text.utf8)
        guard bytes.count == 10, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-") else { return nil }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for byte in bytes[range] {
                guard (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) else { return nil }
                value = value * 10 + Int(byte - UInt8(ascii: "0"))
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
              (1...12).contains(month), (1...daysIn(month, year)).contains(day) else { return nil }
        return (year, month, day)
    }

    static func isValid(_ text: String) -> Bool { parse(text) != nil }

    static func daysIn(_ month: Int, _ year: Int) -> Int {
        switch month {
        case 2: return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    /// The day before a valid date, or `nil` (for an invalid date or 0000-01-01).
    static func previousDay(_ text: String) -> String? {
        guard let parsed = parse(text) else { return nil }
        var (year, month, day) = parsed
        if day > 1 {
            day -= 1
        } else if month > 1 {
            month -= 1
            day = daysIn(month, year)
        } else {
            guard year > 0 else { return nil }
            year -= 1
            month = 12
            day = 31
        }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }
}
