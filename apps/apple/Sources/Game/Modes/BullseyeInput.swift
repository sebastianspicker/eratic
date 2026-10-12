import SwiftUI
import EraticCore

/// Bullseye: a hidden year per player, plus the wager when stakes are on.
struct BullseyeInput: View {
    let session: GameSession
    let state: GameState
    @EnvironmentObject private var game: GameController
    @State private var current: String?
    @State private var year = ""
    @State private var yearError: String?
    @State private var wager = 1
    @AppStorage(EntryMode.key) private var entry = EntryMode.each.rawValue
    @State private var years: [String: String] = [:]
    @State private var wagers: [String: Int] = [:]
    @State private var rowErrors: [String: String] = [:]

    private func isLocked(_ player: String) -> Bool { state.guesses[player] != nil && !state.owesWager(player) }

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

    /// Every pending player's year (and wager) on one list, locked together.
    private var allAtOnce: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(session.players, id: \.id) { player in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(player.name).font(.headline)
                        Spacer()
                        if isLocked(player.id) { Label("Locked", systemImage: "lock.fill").foregroundStyle(.secondary) }
                    }
                    if !isLocked(player.id) {
                        if state.guesses[player.id] == nil {
                            YearEntry(label: "\(player.name)'s year", text: Binding(get: { years[player.id] ?? "" }, set: { years[player.id] = $0 }),
                                      error: rowErrors[player.id])
                        }
                        if session.options.stakes {
                            WagerControl(held: state.chips(for: player.id) ?? 0, wager: Binding(get: { wagers[player.id] ?? 1 }, set: { wagers[player.id] = $0 }))
                        }
                    }
                }
                .padding(12)
                .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            }
            if session.players.contains(where: { !isLocked($0.id) }) {
                Button("Lock in all") { lockAll() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    /// Checks every row first; nothing is dispatched unless all years are valid. Then locks in player order.
    private func lockAll() {
        var parsed: [String: Int] = [:]
        var errors: [String: String] = [:]
        for player in session.players where state.guesses[player.id] == nil {
            if let year = YearEntry.parse(years[player.id] ?? "") {
                parsed[player.id] = year
            } else {
                errors[player.id] = "\(player.name): \(YearEntry.errorText)"
            }
        }
        rowErrors = errors
        guard errors.isEmpty else { return }
        for player in session.players where !isLocked(player.id) {
            if let held = game.state?.chips(for: player.id), held >= 1, game.state?.owesWager(player.id) == true {
                guard game.dispatch(.wager(playerId: player.id, chips: min(wagers[player.id] ?? 1, min(3, held)))) else { return }
            }
            if let year = parsed[player.id] {
                guard game.dispatch(.guess(playerId: player.id, year: year)) else { return }
            }
        }
        years = [:]
        wagers = [:]
    }

    private var oneAtATime: some View {
        LockedEntryList(players: session.players, isLocked: isLocked, current: $current) { player in
            VStack(alignment: .leading, spacing: 10) {
                if state.guesses[player.id] == nil {
                    YearEntry(label: "\(player.name)'s year", text: $year, error: yearError)
                }
                if session.options.stakes {
                    WagerControl(held: state.chips(for: player.id) ?? 0, wager: $wager)
                }
                Button("Lock in") { lock(player.id) }
                    .buttonStyle(.borderedProminent)
            }
        }
        .onChange(of: current) {
            year = ""
            yearError = nil
            wager = 1
        }
    }

    // The wager goes first, so the guess is the entry's last action and Undo takes both back (as on the web).
    private func lock(_ player: String) {
        var parsed: Int?
        if state.guesses[player] == nil {
            parsed = YearEntry.parse(year)
            guard parsed != nil else {
                yearError = YearEntry.errorText
                return
            }
            yearError = nil
        }
        if let held = game.state?.chips(for: player), held >= 1, game.state?.owesWager(player) == true {
            guard game.dispatch(.wager(playerId: player, chips: min(wager, min(3, held)))) else { return }
        }
        if let parsed {
            guard game.dispatch(.guess(playerId: player, year: parsed)) else { return }
        }
        current = nil
        year = ""
        wager = 1
    }
}

/// After a Bullseye reveal: an era-coloured ruler with every guess and the answer, also as text.
struct BullseyeRuler: View {
    let answer: Int
    /// Player name, guess and the player's 1-based number in session order (the ruler marker), in turn order.
    let guesses: [(number: Int, name: String, year: Int)]

    var body: some View {
        let years = guesses.map(\.year) + [answer]
        let low = (years.min() ?? answer) - 2
        let high = (years.max() ?? answer) + 2
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                let width = geometry.size.width
                // Inclusive year cells: the edge after `high` ends exactly at the ruler's width.
                let x: (Int) -> CGFloat = { CGFloat($0 - low) / CGFloat(high - low + 1) * width }
                let center: (Int) -> CGFloat = { x($0) + width / CGFloat(high - low + 1) / 2 }
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
                        Text(String(guess.number))
                            .font(.caption2.weight(.heavy))
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(.background))
                            .overlay(Circle().strokeBorder(.primary, lineWidth: 1.5))
                            .offset(x: min(max(0, width - 20), max(0, center(guess.year) - 10)), y: 2)
                    }
                    Rectangle()
                        .fill(.primary)
                        .frame(width: 3, height: 34)
                        .offset(x: min(max(0, width - 3), max(0, center(answer) - 1.5)), y: 16)
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
                Text("\(guess.number) · \(guess.name): \(String(guess.year)) (\(yearsOffText(Scoring.distance(guess.year, answer))))").font(.callout)
            }
            Text("Answer: \(String(answer))").font(.callout.weight(.semibold))
        }
    }
}
