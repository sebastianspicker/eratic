import SwiftUI
import EraticCore

/// Sudden death by closest year: each tied player enters a hidden year.
struct ClosestYearInput: View {
    let session: GameSession
    let info: SuddenDeathInPlay
    @EnvironmentObject private var game: GameController
    @State private var current: String?
    @State private var year = ""
    @State private var yearError: String?

    var body: some View {
        LockedEntryList(players: session.players.filter { info.players.contains($0.id) }, isLocked: { info.guesses[$0] != nil }, current: $current) { player in
            VStack(alignment: .leading, spacing: 10) {
                YearEntry(label: "\(player.name)'s year", text: $year, error: yearError)
                Button("Lock in") {
                    guard let parsed = YearEntry.parse(year) else {
                        yearError = YearEntry.errorText
                        return
                    }
                    yearError = nil
                    guard game.dispatch(.sdGuess(playerId: player.id, year: parsed)) else { return }
                    current = nil
                    year = ""
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .onChange(of: current) {
            year = ""
            yearError = nil
        }
    }
}

/// Sudden death by first to name: one 5-second clip, then the host records who named it first, or nobody.
struct FirstToNameInput: View {
    let session: GameSession
    let info: SuddenDeathInPlay
    @EnvironmentObject private var game: GameController

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who named it first?").font(.headline)
            if info.nameGiven {
                Text(info.named.map { "Recorded: \(session.playerName($0)) named it first." } ?? "Recorded: nobody named it.").font(.callout)
            } else {
                ForEach(info.players, id: \.self) { player in
                    Button("\(session.playerName(player)) named it first") { game.dispatch(.sdName(playerId: player)) }
                        .buttonStyle(.bordered)
                }
                Button("Nobody named it") { game.dispatch(.sdName(playerId: nil)) }
                    .buttonStyle(.bordered)
            }
        }
        .controlSize(.large)
    }
}

/// "Sudden death: Ada and Lin", replacing the mode's inputs.
struct SuddenDeathBanner: View {
    let session: GameSession
    let info: SuddenDeathInPlay

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Sudden death: \(namesList(info.players.map(session.playerName)))").font(.title3.bold())
            Text(info.kind == .closestYear ? "One song. The closest year wins." : info.kind == .lineup ? "Put \(info.cardCount) songs in order." : "Who named it first?")
                .font(.callout)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .foregroundStyle(Stage.paper)
        .background(Stage.ink, in: RoundedRectangle(cornerRadius: 16))
    }
}
