import SwiftUI
import EraticCore

/// The host screen for one session: top bar, scoreboard, card stage, the mode's inputs, reveal and results.
/// Each mode supplies its input view in `modeInputs`; the rest is shared.
struct HostView: View {
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore
    @EnvironmentObject private var playback: PlaybackHub
    @StateObject private var clip = ClipController()
    @State private var confirmEnd = false

    var body: some View {
        Group {
            if let session = game.session, let state = game.state {
                if let deck = game.deck(loaded: deckStore.deck) {
                    content(session, state, deck)
                } else {
                    ContentUnavailableView {
                        Label("Deck not loaded", systemImage: "rectangle.stack")
                    } description: {
                        Text("Load the deck “\(session.deckTitle)” in the Deck tab to continue this game.")
                    } actions: {
                        Button("Back to Play") { game.leave() }
                    }
                }
            }
        }
        // Leaving Play home, switching tabs or closing the game never leaves a clip running.
        .onDisappear { clip.cancel() }
    }

    private func content(_ session: GameSession, _ state: GameState, _ deck: Deck) -> some View {
        VStack(spacing: 0) {
            topBar(session, state)
            ScoreboardStrip(session: session, state: state)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error = game.lastError {
                        Text(error).foregroundStyle(.red).font(.callout)
                    }
                    if let notice = game.deckNotice {
                        HStack(alignment: .top) {
                            Label(notice, systemImage: "info.circle").font(.callout)
                            Spacer()
                            Button("Done") { game.deckNotice = nil }
                        }
                    }
                    if let announcement = game.announcement {
                        HStack(alignment: .top) {
                            Text(announcement).font(.headline)
                            Spacer()
                            Button("Done") { game.announcement = nil }
                        }
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 12))
                    }
                    if game.showingReveal, let reveal = game.lastReveal {
                        RevealView(reveal: reveal, session: session, deck: deck)
                        Button(state.phase == .finished ? "See results" : "Next card") {
                            game.showingReveal = false
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .keyboardShortcut(.defaultAction)
                    } else if state.phase == .finished {
                        ResultsView(session: session, state: state, deck: deck, clip: clip)
                    } else {
                        if let info = state.suddenDeathInfo { SuddenDeathBanner(session: session, info: info) }
                        CardStage(session: session, state: state, deck: deck, clip: clip)
                        if state.phase == .open || state.phase == .suddenDeathOpen {
                            modeInputs(session, state, deck)
                                .id(inputKey(state))
                            // Snippet Ladder scores the card with its own *Score card*.
                            if !(session.mode == .ladder && state.phase == .open) {
                                revealControls(session, state)
                            }
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Stage.paper)
        }
        .onChange(of: state.currentCard?.cardId) { clip.cancel() }
        .onChange(of: state.phase) { clip.cancel() }
        .onChange(of: session.id) { clip.cancel() }
        .onChange(of: clip.state) {
            // The clip is recorded once it is audible, not when it was requested; a clip that stops first records nothing.
            if clip.state == .idle { game.pendingClipRecords = [] }
            guard case .playing = clip.state else { return }
            let records = game.pendingClipRecords
            game.pendingClipRecords = []
            for record in records {
                guard game.dispatch(record) else { break }
            }
        }
        .onAppear { game.noteDeckDifference(loaded: deckStore.deck) }
        .confirmationDialog("End this game?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End game", role: .destructive) { game.dispatch(.end) }
        } message: {
            Text("A card in play is not scored. A tie for first place goes to sudden death.")
        }
    }

    // MARK: Mode slot

    /// The inputs for the mode (or the sudden-death kind).
    @ViewBuilder
    private func modeInputs(_ session: GameSession, _ state: GameState, _ deck: Deck) -> some View {
        if state.phase == .suddenDeathOpen, let info = state.suddenDeathInfo {
            switch info.kind {
            case .closestYear: ClosestYearInput(session: session, info: info)
            case .firstToName: FirstToNameInput(session: session, info: info)
            case .lineup:
                LineupInput(cards: info.cards, deck: deck, players: session.players.filter { info.players.contains($0.id) }, clipMs: lineupClipMs(session),
                            isLocked: { info.orders[$0] != nil }, submit: { game.dispatch(.sdOrder(playerId: $0, order: $1)) }, clip: clip)
            }
        } else {
            switch session.options {
            case .bullseye: BullseyeInput(session: session, state: state)
            case .eraSort: EraSortInput(session: session, state: state)
            case .higherLower: HigherLowerInput(session: session, state: state, deck: deck)
            case let .daily(options): DailyInput(state: state, options: options)
            case .timeline, .relay: TimelineInput(session: session, state: state, deck: deck)
            case let .ladder(options):
                if let card = state.currentCard {
                    LadderInput(session: session, state: state, deck: deck, options: options, card: card, clip: clip)
                }
            case let .lineup(options):
                LineupInput(cards: state.currentSet, deck: deck, players: session.players, clipMs: options.clipMs,
                            isLocked: { state.orders[$0] != nil }, submit: { game.dispatch(.order(playerId: $0, order: $1)) }, clip: clip)
            case .imposter:
                if let pair = state.currentPair {
                    ImposterInput(session: session, state: state, deck: deck, pair: pair, clip: clip)
                }
            }
        }
    }

    /// Lineup's clip length; Timeline's sudden-death lineup uses the Lineup default.
    private func lineupClipMs(_ session: GameSession) -> Int {
        if case let .lineup(options) = session.options { return options.clipMs }
        return LineupOptions().clipMs
    }

    /// Changes with the card, set or pair in play, so per-card input state starts fresh.
    private func inputKey(_ state: GameState) -> String {
        let ids = state.currentCard.map { [$0.cardId] } ?? (state.currentPair.map { [$0.a.cardId, $0.b.cardId] } ?? state.currentSet.map(\.cardId))
        let sd = state.suddenDeathInfo?.cards.map(\.cardId) ?? []
        return "\(state.phase.rawValue):" + (ids + sd).joined(separator: ",")
    }

    private func revealControls(_ session: GameSession, _ state: GameState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            let pending = state.pendingInputs
            if !pending.isEmpty {
                Text("Still to answer: \(namesList(pending.map(session.playerName)))").font(.callout).foregroundStyle(.secondary)
            }
            Button("Reveal") {
                clip.cancel()
                game.dispatch(.reveal)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!state.canReveal)
        }
    }

    // MARK: Top bar

    private func topBar(_ session: GameSession, _ state: GameState) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.mode == .lineup && !playback.tier.exactClips ? "Lineup by name" : session.mode.name).font(.headline)
                Text(roundText(session, state)).font(.subheadline)
            }
            Spacer()
            Button("Play home") {
                clip.cancel()
                game.leave()
            }
            if state.phase != .finished {
                Button("End game", role: .destructive) { confirmEnd = true }
            }
        }
        .foregroundStyle(Stage.paper)
        .buttonStyle(.bordered)
        .tint(Stage.paper)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Stage.ink)
    }

    private func roundText(_ session: GameSession, _ state: GameState) -> String {
        if state.phase == .finished { return "Game over" }
        if state.phase == .suddenDeath || state.phase == .suddenDeathOpen { return "Sudden death" }
        let next = state.round + 1
        switch session.options {
        case let .bullseye(o): return "Round \(min(next, o.rounds)) of \(o.rounds)"
        case let .eraSort(o): return "Round \(min(next, o.rounds)) of \(o.rounds)"
        case let .ladder(o): return "Round \(min(next, o.rounds)) of \(o.rounds)"
        case let .lineup(o): return "Round \(min(next, o.rounds)) of \(o.rounds)"
        case let .imposter(o): return "Round \(min(next, o.rounds)) of \(o.rounds)"
        case let .daily(o): return "Round \(min(next, o.cards.count)) of \(o.cards.count)"
        case let .timeline(o): return "First to \(o.target) cards"
        case let .relay(o): return "Line of \(o.target) cards · lives \(state.lives) of \(o.lives)"
        case let .higherLower(o): return session.players.count == 1 ? "Solo: until the first miss" : "Card \(min(next, o.cards)) of \(o.cards)"
        }
    }
}

/// Every player's score and, where used, chips, tokens or lives; the active player in words.
private struct ScoreboardStrip: View {
    let session: GameSession
    let state: GameState

    var body: some View {
        let scores = GameEngine.scores(of: state)
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                if session.mode == .relay, case let .relay(options) = session.options {
                    cell(title: "Team", lines: ["Lives \(state.lives) of \(options.lives)", "Line \(state.timeline(for: nil).count) cards"], highlighted: false)
                }
                ForEach(session.players, id: \.id) { player in
                    let active = state.activePlayerID == player.id
                    var lines: [String] = []
                    if session.mode != .relay { lines.append(scoreText(scores[player.id] ?? 0, mode: session.mode, stakes: session.options.stakes)) }
                    if let chips = state.chips(for: player.id) { lines.append("Chips \(chips)") }
                    if let tokens = state.tokens(for: player.id) { lines.append("Tokens \(tokens)") }
                    if state.eliminated.contains(player.id) { lines.append("Out") }
                    if active { lines.append(session.mode == .relay ? "Voice: \(player.name)" : "\(player.name)'s turn") }
                    return cell(title: player.name, lines: lines, highlighted: active)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
        .background(Stage.ink.opacity(0.92))
    }

    private func cell(title: String, lines: [String], highlighted: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.subheadline.weight(.bold))
            ForEach(lines, id: \.self) { Text($0).font(.caption) }
        }
        .foregroundStyle(Stage.paper)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 10).strokeBorder(highlighted ? Stage.paper : Color(hex: "#7A7085"), lineWidth: highlighted ? 2.5 : 1))
        .accessibilityElement(children: .combine)
    }
}
