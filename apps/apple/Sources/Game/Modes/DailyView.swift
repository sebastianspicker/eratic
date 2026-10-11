import SwiftUI
import EraticCore

/// Daily Eratic, solo: era tiles for rounds 1–3, a year for rounds 4–5.
struct DailyInput: View {
    let state: GameState
    let options: DailyOptions
    @EnvironmentObject private var game: GameController
    @State private var era: String?
    @State private var year = 1990

    var body: some View {
        let round = state.round + 1
        let player = state.players[0].id
        VStack(alignment: .leading, spacing: 12) {
            Text("Round \(round) of \(options.cards.count): " + (round <= 3 ? "which era?" : "which year?")).font(.headline)
            if state.pendingInputs.isEmpty {
                Label("Locked", systemImage: "lock.fill").foregroundStyle(.secondary)
            } else if round <= 3 {
                EraGrid(selection: $era)
                Button("Lock in") {
                    guard let era, game.dispatch(.pickEra(playerId: player, era: era)) else { return }
                    self.era = nil
                }
                .buttonStyle(.borderedProminent)
                .disabled(era == nil)
            } else {
                YearField(label: "Your year", year: $year)
                Button("Lock in") { game.dispatch(.guess(playerId: player, year: year)) }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}

/// The day's score, the share text with *Copy*, and the streak.
struct DailyResult: View {
    let score: Int
    let shareText: String?
    let streak: Int
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Played today: \(score) points").font(.headline)
            if let shareText {
                Text(shareText).font(.body.monospaced()).textSelection(.enabled)
                Button(copied ? "Copied" : "Copy") {
                    Clipboard.copy(shareText)
                    copied = true
                }
            }
            Text(streak == 1 ? "Streak: 1 day" : "Streak: \(streak) days").font(.callout)
            Text("Come back tomorrow for a new round.").font(.caption).foregroundStyle(.secondary)
        }
    }
}
