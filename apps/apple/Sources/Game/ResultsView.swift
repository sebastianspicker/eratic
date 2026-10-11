import SwiftUI
import EraticCore

/// Standings ("=1" for shared places), scores and tie-break numbers, then *Play again*, *New game* and *Export session*.
struct ResultsView: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @State private var exporting = false
    @State private var exportError: String?

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
            if case let .daily(options) = session.options {
                let streak = game.daily?.lastDate == options.date ? game.daily?.streak ?? 1 : 1
                DailyResult(score: scores[session.players[0].id] ?? 0, shareText: summary["shareText"] as? String, streak: streak)
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
        .onAppear { game.resultsSeen() }
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
        case .higherLower: break // The score is the streak.
        case .lineup: if let perfect = value("perfect") { out.append("\(perfect) perfect lines") }
        case .imposter: if let bonuses = value("bonuses") { out.append("\(bonuses) year bonuses") }
        case .relay, .daily: break
        }
        if let chips = value("chips") { out.append("\(chips) chips") }
        return out
    }
}
