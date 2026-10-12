import SwiftUI
import EraticCore

/// Timeline and Relay: the active player (Relay: the voice) places the card in a slot; then challenges,
/// Name It and the wager where the options turn them on.
struct TimelineInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @EnvironmentObject private var game: GameController
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var slot: Int?
    @State private var challenger: String?
    @State private var challengeSlot: Int?
    @State private var titleOK = false
    @State private var artistOK = false
    @State private var wager = 1
    @State private var shownPlayer: String?

    private var personal: Bool {
        if case let .timeline(options) = session.options { return options.ownership == .personal }
        return false
    }

    private var challengesOn: Bool {
        if case let .timeline(options) = session.options { return options.challenges }
        return false
    }

    private var nameItOn: Bool {
        switch session.options {
        case let .timeline(options): return options.nameIt
        case let .relay(options): return options.nameIt
        default: return false
        }
    }

    private var large: Bool { game.kids }

    var body: some View {
        if let active = state.activePlayerID {
            let name = session.playerName(active)
            let line = state.timeline(for: personal ? active : nil)
            VStack(alignment: .leading, spacing: 16) {
                header(name)
                if let placed = state.placement {
                    afterPlacement(active, name, line, placed)
                } else {
                    Text(personal ? "Where does this song go in \(name)'s timeline?" : "Where does this song go in the line?").font(.headline)
                    TimelineStrip(cards: line, deck: deck, large: large, selected: slot, onSelect: { slot = $0 }, onSubmit: { place(active) })
                    Button(slot.map { "Place: \(TimelineStrip.slotLabel(line.map(\.year), $0))" } ?? "Choose a slot") { place(active) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(large ? .extraLarge : .large)
                        .disabled(slot == nil)
                }
                if personal { otherTimelines(active) }
            }
            .onChange(of: state.currentCard?.cardId) { reset() }
            .onChange(of: state.placement) {
                // An undone placement leaves no challenge in progress.
                challenger = nil
                challengeSlot = nil
            }
        }
    }

    @ViewBuilder
    private func header(_ name: String) -> some View {
        if case let .relay(options) = session.options {
            HStack(spacing: 10) {
                Text("Voice: \(name)")
                    .font(.headline)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .foregroundStyle(Stage.paper)
                    .background(Capsule().fill(Stage.ink))
                Text("Lives \(state.lives) of \(options.lives)").font(.headline)
            }
        } else {
            Text("\(name)'s turn").font(.title3.bold())
        }
    }

    // MARK: After the placement

    @ViewBuilder
    private func afterPlacement(_ active: String, _ name: String, _ line: [CardRef], _ placed: Int) -> some View {
        let years = line.map(\.year)
        let claims = Dictionary(state.challenges.map { ($0.slot, "\(session.playerName($0.playerId))'s claim") }, uniquingKeysWith: { first, _ in first })
        Text("\(name) placed it: \(TimelineStrip.slotLabel(years, placed))").font(.headline)
        if let challenger {
            TimelineStrip(cards: line, deck: deck, large: large, selected: challengeSlot, selectedText: "\(session.playerName(challenger))'s slot",
                          taken: claims.merging([placed: "\(name)'s slot"]) { first, _ in first },
                          onSelect: { challengeSlot = $0 }, onSubmit: { challenge(challenger) })
        } else {
            TimelineStrip(cards: line, deck: deck, large: large, selected: placed, taken: claims)
        }
        if challengesOn { challenges(active, years) }
        if nameItOn { nameIt(active) }
        if session.options.stakes { wagerControls(active) }
    }

    private func challenges(_ active: String, _ years: [Int]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Challenges").font(.headline)
            Text("Anyone with a token may claim a free slot.").font(.caption).foregroundStyle(.secondary)
            ForEach(session.players.filter { $0.id != active }, id: \.id) { player in
                let tokens = state.tokens(for: player.id) ?? 0
                HStack {
                    Text(player.name)
                    Text(tokens == 1 ? "1 token" : "\(tokens) tokens").font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    if let claim = state.challenges.first(where: { $0.playerId == player.id }) {
                        Text("Claims \(TimelineStrip.slotLabel(years, claim.slot))").font(.callout)
                    } else if challenger == player.id {
                        Button("Cancel") { challenger = nil; challengeSlot = nil }
                    } else if tokens >= 1 {
                        Button("Challenge") { challenger = player.id; challengeSlot = nil }
                            .accessibilityLabel("Challenge as \(player.name)")
                    } else {
                        Text("No tokens").font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
            if let challenger {
                Button(challengeSlot.map { "Claim for \(session.playerName(challenger)): \(TimelineStrip.slotLabel(years, $0))" } ?? "Choose a free slot") {
                    challenge(challenger)
                }
                .buttonStyle(.borderedProminent)
                .disabled(challengeSlot == nil)
            }
        }
        .controlSize(large ? .large : .regular)
    }

    @ViewBuilder
    private func nameIt(_ active: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Name It").font(.headline)
            if let marks = state.nameItMarks {
                Text("Recorded: title \(marks.titleOK ? "right" : "wrong"), artist \(marks.artistOK ? "right" : "wrong").").font(.callout)
            } else {
                Toggle("Title right", isOn: $titleOK)
                Toggle("Artist right", isOn: $artistOK)
                Button("Record Name It") { game.dispatch(.nameIt(playerId: active, titleOK: titleOK, artistOK: artistOK)) }
                    .buttonStyle(.bordered)
            }
        }
        .controlSize(large ? .large : .regular)
    }

    @ViewBuilder
    private func wagerControls(_ active: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Wager").font(.headline)
            if let placed = state.wagers[active] {
                Text("\(session.playerName(active)) wagered \(placed).").font(.callout)
            } else {
                let held = state.chips(for: active) ?? 0
                WagerControl(held: held, wager: $wager)
                if state.owesWager(active) {
                    Button("Lock wager") { game.dispatch(.wager(playerId: active, chips: min(wager, min(3, held)))) }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    // MARK: Other timelines

    @ViewBuilder
    private func otherTimelines(_ active: String) -> some View {
        let others = session.players.filter { $0.id != active }
        VStack(alignment: .leading, spacing: 8) {
            Text("Other timelines").font(.headline)
            if compactWidth {
                Picker("Show timeline", selection: Binding(get: { shownPlayer ?? others.first?.id ?? "" }, set: { shownPlayer = $0 })) {
                    ForEach(others, id: \.id) { Text($0.name).tag($0.id) }
                }
                if let player = others.first(where: { $0.id == (shownPlayer ?? others.first?.id) }) {
                    compactLine(player)
                }
            } else {
                ForEach(others, id: \.id) { compactLine($0) }
            }
        }
    }

    private func compactLine(_ player: SessionPlayer) -> some View {
        let cards = state.timeline(for: player.id)
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(player.name) · \(cards.count == 1 ? "1 card" : "\(cards.count) cards")").font(.callout.weight(.semibold))
            TimelineStrip(cards: cards, deck: deck, compact: true)
        }
    }

    private var compactWidth: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    // MARK: Actions

    private func place(_ active: String) {
        guard let slot, game.dispatch(.place(playerId: active, slot: slot)) else { return }
        self.slot = nil
    }

    private func challenge(_ player: String) {
        guard let challengeSlot, game.dispatch(.challenge(playerId: player, slot: challengeSlot)) else { return }
        challenger = nil
        self.challengeSlot = nil
    }

    private func reset() {
        slot = nil
        challenger = nil
        challengeSlot = nil
        titleOK = false
        artistOK = false
        wager = 1
    }
}
