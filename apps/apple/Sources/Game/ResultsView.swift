import SwiftUI
import EraticCore

/// Standings ("=1" for shared places), scores and tie-break numbers, the personal best where one is kept, a collapsed
/// card-by-card recap, then *Play again*, *New game* and *Export session*.
struct ResultsView: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @State private var exporting = false
    @State private var exportError: String?
    /// The personal best for a one-player game or Relay, recorded once when the results appear.
    @State private var best: Bests.Outcome?

    var body: some View {
        let summary = GameEngine.summary(of: state)
        let scores = GameEngine.scores(of: state)
        VStack(alignment: .leading, spacing: 16) {
            Text("Results").font(.largeTitle.bold())
            if session.mode == .relay {
                let outcome = summary["outcome"] as? String ?? ""
                Text(outcome == "won" ? "The team won!" : outcome == "lost" ? "The team ran out of lives." : "The game was ended.").font(.title2.bold())
                Text("Team score: \(summary["teamScore"] as? Int ?? 0)")
            } else {
                ForEach(Array(places(GameEngine.standings(of: state)).enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        Text(entry.place)
                            .font(.title2.weight(.heavy).monospacedDigit())
                            .frame(minWidth: 44, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.playerName(entry.player)).font(.headline)
                            let extra = tieBreaks(entry.player, summary)
                            Text(([score(entry.player, scores)] + extra).joined(separator: " · ")).font(.callout)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Place \(entry.place.replacingOccurrences(of: "=", with: "shared ")), \(session.playerName(entry.player)), \(score(entry.player, scores))")
                }
                if let winner = state.suddenDeathInfo?.winner {
                    Text("\(session.playerName(winner)) won the sudden death.").font(.callout)
                }
            }
            if let best {
                Text(best.isNew ? "New best: \(best.best)!" : "Best: \(best.best)").font(.headline)
            }
            if case let .daily(options) = session.options {
                let streak = game.daily?.lastDate == options.date ? game.daily?.streak ?? 1 : 1
                DailyResult(score: scores[session.players[0].id] ?? 0, shareText: summary["shareText"] as? String, streak: streak)
            }
            DisclosureGroup("Card by card") {
                VStack(alignment: .leading, spacing: 6) {
                    let lines = Recap.lines(session: session, deck: deck)
                    if lines.isEmpty { Text("No cards were revealed.").font(.callout) }
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.callout)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
            }
            HStack(spacing: 12) {
                if session.mode != .daily {
                    Button("Play again") {
                        clip.cancel()
                        game.playAgain(deck: deck)
                    }
                    .buttonStyle(.borderedProminent)
                }
                Button("New game") {
                    clip.cancel()
                    game.leave()
                }
                Button("Export session") { exporting = true }
            }
            .controlSize(.large)
            if let exportError { Text(exportError).foregroundStyle(.red).font(.callout) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .onAppear {
            game.resultsSeen()
            let score = session.mode == .relay ? (summary["teamScore"] as? Int ?? 0) : (scores[session.players.first?.id ?? ""] ?? 0)
            // Recorded once per session: a second appearance shows the same outcome ("New best" stays).
            if let kept = game.bestOutcome, kept.sessionId == session.id {
                best = kept.outcome
            } else {
                best = Bests.record(session: session, score: score)
                game.bestOutcome = best.map { (sessionId: session.id, outcome: $0) }
            }
        }
        .fileExporter(isPresented: $exporting, document: SessionDocument(session: session), contentType: .json, defaultFilename: session.id) { result in
            if case let .failure(error) = result { exportError = error.localizedDescription }
        }
    }

    private func score(_ player: String, _ scores: [String: Int]) -> String {
        scoreText(scores[player] ?? 0, mode: session.mode, stakes: session.options.stakes)
    }

    /// Each player with a place label: "1", or "=1" when a place is shared.
    private func places(_ groups: [[String]]) -> [(place: String, player: String)] {
        var out: [(place: String, player: String)] = []
        var placed = 0
        for group in groups {
            let label = group.count > 1 ? "=\(placed + 1)" : "\(placed + 1)"
            out += group.map { (place: label, player: $0) }
            placed += group.count
        }
        return out
    }

    /// The mode's tie-break numbers from the summary.
    private func tieBreaks(_ player: String, _ summary: [String: Any]) -> [String] {
        func value(_ key: String) -> Int? { (summary[key] as? [String: Int])?[player] }
        var out: [String] = []
        switch session.mode {
        case .bullseye:
            if let exact = value("exact") { out.append("\(exact) exact") }
            if let distance = value("distance") { out.append("\(distance) years off in total") }
        case .eraSort: if let right = value("rightEras") { out.append("\(right) right eras") }
        case .timeline: if let wrong = value("wrong") { out.append("\(wrong) wrong placements") }
        case .ladder:
            if let used = value("usedMs") { out.append("\(used / 1000) s listened") }
            if let exact = value("exactYears") { out.append("\(exact) exact years") }
            if let buzzers = value("buzzers") { out.append("\(buzzers) buzzer\(buzzers == 1 ? "" : "s")") }
        case .higherLower: break // The score is the streak.
        case .lineup: if let perfect = value("perfect") { out.append("\(perfect) perfect lines") }
        case .imposter: if let bonuses = value("bonuses") { out.append("\(bonuses) year bonuses") }
        case .relay, .daily: break
        }
        if let chips = value("chips") { out.append("\(chips) chips") }
        return out
    }
}

/// The card-by-card recap: the session replayed with `GameEngine`, one line per reveal, in order. Scores are read from
/// the engine's states before and after each reveal (never re-scored).
enum Recap {
    static func lines(session: GameSession, deck: Deck) -> [String] {
        guard var state = try? GameEngine.start(options: session.options, players: session.players, seed: session.seed,
                                                sessionVersion: session.sessionVersion) else { return [] }
        var out: [String] = []
        for action in session.actions {
            guard let next = try? GameEngine.apply(action, to: state) else { break }
            if case .reveal = action.action {
                out.append("\(out.count + 1). " + line(before: state, after: next, session: session, deck: deck))
            }
            state = next
        }
        return out
    }

    private static func line(before: GameState, after: GameState, session: GameSession, deck: Deck) -> String {
        if before.phase == .suddenDeathOpen, let info = before.suddenDeathInfo {
            let what = info.cards.count > 1 ? setText(info.cards, deck) : info.cards.first.map { cardText($0, deck) } ?? ""
            return "Sudden death: \(what): " + suddenDeathOutcome(after, session)
        }
        if session.mode == .relay {
            let grew = after.timeline(for: nil).count > before.timeline(for: nil).count
            return (before.currentCard.map { cardText($0, deck) } ?? "") + ": " + (grew ? "+1 card for the team" : "lost a life")
        }
        let what: String
        if let pair = before.currentPair {
            let original = pair.original == .a ? pair.a : pair.b
            what = "Original \(cardText(original, deck))"
        } else if !before.currentSet.isEmpty {
            what = setText(before.currentSet, deck)
        } else {
            what = before.currentCard.map { cardText($0, deck) } ?? ""
        }
        return "\(what): " + scorers(before: before, after: after, session: session)
    }

    /// "1984 · Title — Artist".
    private static func cardText(_ card: CardRef, _ deck: Deck) -> String {
        let song = deck.card(card.cardId)
        return "\(String(card.year)) · \(song?.title ?? card.cardId)" + (song.map { " — \($0.artist)" } ?? "")
    }

    /// The set's titles in the right order (by year; equal years keep their tile order).
    private static func setText(_ cards: [CardRef], _ deck: Deck) -> String {
        let ordered = cards.enumerated().sorted { $0.element.year != $1.element.year ? $0.element.year < $1.element.year : $0.offset < $1.offset }
        return ordered.map { deck.card($0.element.cardId)?.title ?? $0.element.cardId }.joined(separator: ", ")
    }

    /// The player(s) with the highest positive score change ("Ada +10", "Ada and Lin +5"), or "nobody scored".
    private static func scorers(before: GameState, after: GameState, session: GameSession) -> String {
        let scoresBefore = GameEngine.scores(of: before)
        let scoresAfter = GameEngine.scores(of: after)
        let deltas = session.players.map { (player: $0, delta: (scoresAfter[$0.id] ?? 0) - (scoresBefore[$0.id] ?? 0)) }
        guard let top = deltas.map(\.delta).max(), top > 0 else { return "nobody scored" }
        return "\(namesList(deltas.filter { $0.delta == top }.map(\.player.name))) \(signedPoints(top))"
    }
}
