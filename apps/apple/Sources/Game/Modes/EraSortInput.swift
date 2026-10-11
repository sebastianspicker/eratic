import SwiftUI
import EraticCore

/// Era Sort: each player picks one of the nine era tiles, hidden until the reveal.
struct EraSortInput: View {
    let session: GameSession
    let state: GameState
    @EnvironmentObject private var game: GameController
    @State private var current: String?
    @State private var era: String?

    private var kids: Bool {
        if case let .eraSort(options) = session.options { return options.kids }
        return false
    }

    var body: some View {
        LockedEntryList(players: session.players, isLocked: { state.picks[$0] != nil }, current: $current) { player in
            VStack(alignment: .leading, spacing: 10) {
                EraGrid(selection: $era, large: kids)
                Button("Lock in") {
                    guard let era, game.dispatch(.pickEra(playerId: player.id, era: era)) else { return }
                    self.era = nil
                    current = nil
                }
                .buttonStyle(.borderedProminent)
                .controlSize(kids ? .extraLarge : .regular)
                .disabled(era == nil)
            }
        }
        .onChange(of: current) { era = nil }
    }
}
