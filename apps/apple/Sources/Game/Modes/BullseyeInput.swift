import SwiftUI
import EraticCore

/// Bullseye: a hidden year per player, plus the wager when stakes are on.
struct BullseyeInput: View {
    let session: GameSession
    let state: GameState
    @EnvironmentObject private var game: GameController
    @State private var current: String?
    @State private var year = 1990
    @State private var wager = 1

    var body: some View {
        LockedEntryList(players: session.players, isLocked: { state.guesses[$0] != nil && !state.owesWager($0) }, current: $current) { player in
            VStack(alignment: .leading, spacing: 10) {
                if state.guesses[player.id] == nil {
                    YearField(label: "\(player.name)'s year", year: $year)
                }
                if session.options.stakes {
                    WagerControl(held: state.chips(for: player.id) ?? 0, wager: $wager)
                }
                Button("Lock in") { lock(player.id) }
                    .buttonStyle(.borderedProminent)
            }
        }
        .onChange(of: current) {
            year = 1990
            wager = 1
        }
    }

    private func lock(_ player: String) {
        if state.guesses[player] == nil, !game.dispatch(.guess(playerId: player, year: year)) { return }
        if let held = game.state?.chips(for: player), held >= 1, game.state?.owesWager(player) == true {
            guard game.dispatch(.wager(playerId: player, chips: min(wager, min(3, held)))) else { return }
        }
        current = nil
        year = 1990
        wager = 1
    }
}

/// After a Bullseye reveal: an era-coloured ruler with every guess and the answer, also as text.
struct BullseyeRuler: View {
    let answer: Int
    /// Player name and guess, in turn order.
    let guesses: [(name: String, year: Int)]

    var body: some View {
        let years = guesses.map(\.year) + [answer]
        let low = (years.min() ?? answer) - 2
        let high = (years.max() ?? answer) + 2
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                let width = geometry.size.width
                let x: (Int) -> CGFloat = { CGFloat($0 - low) / CGFloat(max(1, high - low)) * width }
                ZStack(alignment: .topLeading) {
                    ForEach(EraBoundaries.all) { boundary in
                        let from = max(low, boundary.from ?? low)
                        let to = min(high, boundary.to ?? high)
                        if from <= to {
                            Rectangle()
                                .fill(Eras.all.first { $0.id == boundary.id }?.accentColor ?? .secondary)
                                .frame(width: max(1, x(to + 1) - x(from)), height: 14)
                                .offset(x: x(from), y: 26)
                        }
                    }
                    ForEach(Array(guesses.enumerated()), id: \.offset) { _, guess in
                        Text(String(guess.name.prefix(1)))
                            .font(.caption2.weight(.heavy))
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(.background))
                            .overlay(Circle().strokeBorder(.primary, lineWidth: 1.5))
                            .offset(x: x(guess.year) - 10, y: 2)
                    }
                    Rectangle()
                        .fill(.primary)
                        .frame(width: 3, height: 34)
                        .offset(x: x(answer) - 1.5, y: 16)
                }
            }
            .frame(height: 52)
            .accessibilityHidden(true)
            HStack {
                Text(String(low))
                Spacer()
                Text(String(high))
            }
            .font(.caption.monospacedDigit())
            .accessibilityHidden(true)
            ForEach(Array(guesses.enumerated()), id: \.offset) { _, guess in
                Text("\(guess.name): \(String(guess.year)), \(yearsOffText(Scoring.distance(guess.year, answer)))").font(.callout)
            }
            Text("Answer: \(String(answer))").font(.callout.weight(.semibold))
        }
    }
}
