import Foundation
import EraticCore

/// One personal best: the score and the session that set it.
struct BestEntry: Codable, Equatable {
    var score: Int
    var sessionId: String
}

/// Personal bests on this device, in `UserDefaults` (`eratic.bests.v1`) as JSON `{deckId: {kind: {score, sessionId}}}`.
/// Kinds, by game length: `relay-<target>-<lives>` (the team score) and `solo-<mode>-<length>` for a finished one-player
/// game other than Daily, where the length is the rounds, cards (Higher or Lower), target (Timeline) or `k x rounds` as
/// `4x5` (Lineup). A game the host ended early keeps no best.
/// Unreadable data counts as no bests.
enum Bests {
    static let key = "eratic.bests.v1"
    typealias Table = [String: [String: BestEntry]]

    /// What the session's result shows: the best so far, and whether this session strictly beat the previous one.
    struct Outcome: Equatable {
        let best: Int
        let isNew: Bool
    }

    /// The kind a session's result counts towards, or nil when it doesn't keep a best.
    static func kind(for session: GameSession) -> String? {
        if session.actions.last.map({ $0.action == .end }) == true { return nil }
        if case let .relay(options) = session.options { return "relay-\(options.target)-\(options.lives)" }
        guard session.players.count == 1 else { return nil }
        let length: String
        switch session.options {
        case let .ladder(options): length = String(options.rounds)
        case let .timeline(options): length = String(options.target)
        case let .bullseye(options): length = String(options.rounds)
        case let .eraSort(options): length = String(options.rounds)
        case let .higherLower(options): length = String(options.cards)
        case let .lineup(options): length = "\(options.k)x\(options.rounds)"
        case let .imposter(options): length = String(options.rounds)
        case .relay, .daily: return nil
        }
        return "solo-\(session.mode.rawValue)-\(length)"
    }

    static func load(_ defaults: UserDefaults = .standard) -> Table {
        guard let data = defaults.data(forKey: key), let table = try? JSONDecoder().decode(Table.self, from: data) else { return [:] }
        return table
    }

    /// Records a finished session's score once: a session already stored isn't counted again, and a score replaces
    /// the best only when it is strictly higher (or there is none yet).
    static func record(session: GameSession, score: Int, defaults: UserDefaults = .standard) -> Outcome? {
        guard let kind = kind(for: session) else { return nil }
        var table = load(defaults)
        let previous = table[session.deckId]?[kind]
        if let previous, previous.sessionId == session.id { return Outcome(best: previous.score, isNew: false) }
        if let previous, score <= previous.score { return Outcome(best: previous.score, isNew: false) }
        table[session.deckId, default: [:]][kind] = BestEntry(score: score, sessionId: session.id)
        if let data = try? JSONEncoder().encode(table) { defaults.set(data, forKey: key) }
        return Outcome(best: score, isNew: previous != nil)
    }
}
