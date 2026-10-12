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

    @AppStorage(EntryMode.key) private var entry = EntryMode.each.rawValue
    @State private var picks: [String: String] = [:]
    @State private var missing: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if session.players.count > 1 { EntryModePicker(mode: $entry) }
            if entry == EntryMode.all.rawValue, session.players.count > 1 {
                allAtOnce
            } else {
                oneAtATime
            }
        }
    }

    /// Every pending player's era in one list, locked together.
    private var allAtOnce: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(session.players, id: \.id) { player in
                HStack {
                    Text(player.name).font(.headline)
                    Spacer()
                    if state.picks[player.id] != nil {
                        Label("Locked", systemImage: "lock.fill").foregroundStyle(.secondary)
                    } else {
                        Picker("\(player.name)'s era", selection: Binding(get: { picks[player.id] ?? "" }, set: { picks[player.id] = $0.isEmpty ? nil : $0 })) {
                            Text("Choose an era").tag("")
                            ForEach(EraBoundaries.all) { boundary in
                                Text(boundary.name + ", " + (Eras.all.first { $0.id == boundary.id }?.label ?? "")).tag(boundary.id)
                            }
                        }
                    }
                }
                .padding(12)
                .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                if missing.contains(player.id) {
                    Text("Choose an era for \(player.name).").font(.callout).foregroundStyle(.red)
                }
            }
            if session.players.contains(where: { state.picks[$0.id] == nil }) {
                Button("Lock in all") { lockAll() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(kids ? .extraLarge : .regular)
            }
        }
    }

    /// Checks every row first; nothing is dispatched unless every pending player chose an era. Then locks in player order.
    private func lockAll() {
        let pending = session.players.filter { state.picks[$0.id] == nil }
        missing = Set(pending.filter { picks[$0.id] == nil }.map(\.id))
        guard missing.isEmpty else { return }
        for player in pending {
            guard let era = picks[player.id], game.dispatch(.pickEra(playerId: player.id, era: era)) else { return }
        }
        picks = [:]
    }

    private var oneAtATime: some View {
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
