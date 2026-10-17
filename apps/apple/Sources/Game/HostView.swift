import AVFoundation
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
    private let hasCamera = AVCaptureDevice.default(for: .video) != nil

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
        // A hosted game keeps the iPhone/iPad screen on, so previews and the stage survive a quiet round.
        .onAppear { Self.keepScreenOn(true) }
        // Leaving Play home, switching tabs or closing the game never leaves a clip running.
        .onDisappear {
            clip.cancel()
            Self.keepScreenOn(false)
        }
    }

    private static func keepScreenOn(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
        #endif
    }

    private func content(_ session: GameSession, _ state: GameState, _ deck: Deck) -> some View {
        VStack(spacing: 0) {
            topBar(session, state, deck)
            // A reveal keeps the scoreboard at the start of the round; it catches up with *Next card*.
            ScoreboardStrip(session: session, state: game.showingReveal && state.phase != .finished ? (game.lastReveal?.before ?? state) : state)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let error = game.lastError {
                            ErrorText(error)
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
                            Button(state.phase == .finished ? "See results" : nextLabel(session, reveal)) {
                                nextCard(state, deck)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(hostControlSize(session))
                            .keyboardShortcut(.defaultAction)
                        } else if state.phase == .finished {
                            ResultsView(session: session, state: state, deck: deck, clip: clip)
                        } else {
                            if let info = state.suddenDeathInfo { SuddenDeathBanner(session: session, info: info) }
                            CardStage(session: session, state: state, deck: deck, clip: clip)
                            if state.phase == .open || state.phase == .suddenDeathOpen {
                                modeInputs(session, state, deck)
                                    .id(inputKey(state))
                                // Snippet Ladder reports its answer and playing steps through `ladderBusy`, which
                                // hides Undo (a step is logged once audible, so a lock could be undone and redone after hearing more).
                                if game.canUndoBatch {
                                    Button("Undo all entries") { game.undoBatch() }
                                        .buttonStyle(.bordered)
                                        .controlSize(hostControlSize(session))
                                }
                                if !game.ladderBusy, let undoable = game.undoable {
                                    Button(undoable.label) { game.undo() }
                                        .buttonStyle(.bordered)
                                        .controlSize(hostControlSize(session))
                                }
                                // Snippet Ladder scores the card with its own *Score card*; Higher or Lower with turns reveals with its call.
                                if !(session.mode == .ladder && state.phase == .open),
                                   !(session.mode == .higherLower && !state.isEveryonePlay && state.phase == .open && state.call == nil) {
                                    revealControls(session, state)
                                }
                            }
                        }
                    }
                    .id("host-content-top")
                    .padding(20)
                    .frame(maxWidth: 820, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .background(Stage.paper)
                #if os(iOS)
                .scrollDismissesKeyboard(.interactively)
                #endif
                // Reveal, next card and results each start with their heading visible.
                // Entry edits and undo keep the current scroll position.
                .onChange(of: game.showingReveal) { proxy.scrollTo("host-content-top", anchor: .top) }
                .onChange(of: inputKey(state)) { proxy.scrollTo("host-content-top", anchor: .top) }
            }
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
        .onChange(of: game.showingReveal) {
            guard game.showingReveal, let reveal = game.lastReveal else { return }
            AccessibilityNotification.Announcement(revealSummary(reveal, session, deck)).post()
        }
        .onChange(of: game.lastError) {
            if let error = game.lastError { AccessibilityNotification.Announcement(error).post() }
        }
        .onAppear { game.noteDeckDifference(loaded: deckStore.deck) }
        .confirmationDialog("End this game now?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End game", role: .destructive) { game.dispatch(.end) }
        } message: {
            Text(game.endGameMessage)
        }
    }

    /// What the button brings next: a card, or a whole pair or lineup.
    private func nextLabel(_ session: GameSession, _ reveal: RevealSnapshot) -> String {
        if reveal.before.phase == .suddenDeathOpen { return "Next card" }
        switch session.mode {
        case .imposter: return "Next pair"
        case .lineup: return "Next lineup"
        default: return "Next card"
        }
    }

    /// Closes the reveal and, like the web host, draws the next card at once when the card source is the deck
    /// (or the mode can't scan one card at a time). A finished game just goes on to its results.
    private func nextCard(_ state: GameState, _ deck: Deck) {
        game.dismissReveal()
        guard state.phase != .finished else { return }
        let scanHere = hasCamera && SetupView.scanModes(state.mode) && game.drawCount == 1
        if game.cardSource == .draw || !scanHere, game.canDraw(in: deck) {
            game.drawFromDeck(deck)
        }
    }

    /// One line for VoiceOver: "1984 · Neon. Ada +7, 1 year off. Lin 0."; Relay says what happened to the team, Higher or Lower who was right.
    private func revealSummary(_ reveal: RevealSnapshot, _ session: GameSession, _ deck: Deck) -> String {
        let before = reveal.before
        var parts: [String] = []
        if let card = before.currentCard ?? before.suddenDeathInfo?.cards.first {
            let song = deck.card(card.cardId)?.title ?? card.cardId
            parts.append([String(card.year), Eras.for(card.year)?.name, song].compactMap { $0 }.joined(separator: " · ") + ".")
        }
        let after = reveal.after
        let scoresBefore = GameEngine.scores(of: before)
        let scoresAfter = GameEngine.scores(of: after)
        switch session.mode {
        case .relay:
            // The line belongs to the team: say whether the card was placed, then the team's state.
            let line = after.timeline(for: nil).count
            parts.append(line > before.timeline(for: nil).count ? "Card placed." : "Wrong, a life is lost.")
            if case let .relay(options) = session.options {
                parts.append("Lives \(after.lives) of \(options.lives), line \(line) of \(options.target).")
            }
            if after.outcome == "won" { parts.append("The line is complete. The team wins!") }
            if after.outcome == "lost" { parts.append("Out of lives. The team loses.") }
        case .higherLower:
            // The score is the streak: a caller who gained on it was right.
            let callers = before.isEveryonePlay ? session.players.filter { before.calls[$0.id] != nil } : session.players.filter { $0.id == before.activePlayerID }
            for player in callers {
                let streak = scoresAfter[player.id] ?? 0
                let out = after.eliminated.contains(player.id) && !before.eliminated.contains(player.id)
                let result = streak > (scoresBefore[player.id] ?? 0) ? "right, streak \(streak)" : out ? "missed, out" : "missed"
                parts.append("\(player.name) \(result).")
            }
        default:
            for player in session.players {
                var text = "\(player.name) " + signedPoints((scoresAfter[player.id] ?? 0) - (scoresBefore[player.id] ?? 0))
                if let card = before.currentCard, let guess = before.guesses[player.id] {
                    text += ", " + yearsOffText(Scoring.distance(guess, card.year))
                }
                parts.append(text + ".")
            }
        }
        return parts.joined(separator: " ")
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
            case .higherLower: HigherLowerInput(session: session, state: state, deck: deck, clip: clip)
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

    /// Kids (Era Sort's option, Timeline's preset) enlarges the host's action buttons as well as the mode's own controls.
    private func hostControlSize(_ session: GameSession) -> ControlSize {
        if case let .eraSort(options) = session.options, options.kids { return .extraLarge }
        return game.kids ? .extraLarge : .large
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
            .controlSize(hostControlSize(session))
            .disabled(!state.canReveal)
        }
    }

    // MARK: Top bar

    private func topBar(_ session: GameSession, _ state: GameState, _ deck: Deck) -> some View {
        let title = VStack(alignment: .leading, spacing: 2) {
            Text(session.mode == .lineup && LineupPlayMode.byName(deck: deck, tier: playback.tier) ? "Lineup by name" : session.mode.name).font(.headline)
            // A reveal names the round just played, not the next one.
            Text(roundText(session, game.showingReveal ? (game.lastReveal?.before ?? state) : state)).font(.subheadline)
            if let finalRound = state.finalRoundPlayers, !finalRound.isEmpty {
                Text("Final round: \(namesList(finalRound.map(session.playerName))) still to play.").font(.subheadline.weight(.semibold))
            }
        }
        let finished = state.phase == .finished
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                title
                Spacer()
                Button("Play home") { playHome() }
                if !finished {
                    Button("End game", role: .destructive) { confirmEnd = true }
                }
            }
            // Narrow phones: the two actions share one menu.
            HStack(spacing: 12) {
                title
                Spacer()
                Menu {
                    Button("Play home") { playHome() }
                    if !finished {
                        Button("End game", role: .destructive) { confirmEnd = true }
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
            }
        }
        .foregroundStyle(Stage.paper)
        .buttonStyle(.bordered)
        .tint(Stage.paper)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Stage.ink)
    }

    private func playHome() {
        clip.cancel()
        game.leave()
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
        case let .timeline(o):
            return o.ownership == .shared ? "Shared line \(state.timeline(for: nil).count) of \(o.target)" : "First to \(o.target) cards"
        case let .relay(o): return "Line of \(o.target) cards · lives \(state.lives) of \(o.lives)"
        case let .higherLower(o): return session.players.count == 1 ? (o.play == .everyone ? "Solo: until the last life" : "Solo: until the first miss") : "Card \(min(next, o.cards)) of \(o.cards)"
        }
    }
}

/// Every player's score and, where used, chips, tokens or lives; the active player in words.
private struct ScoreboardStrip: View {
    let session: GameSession
    let state: GameState

    var body: some View {
        let scores = GameEngine.scores(of: state)
        // Wraps so every player is visible, at TV distance too; the score is the large line.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .topLeading)], alignment: .leading, spacing: 10) {
            if session.mode == .relay, case let .relay(options) = session.options {
                cell(title: "Team", lines: ["Lives \(state.lives) of \(options.lives)", "Line \(state.timeline(for: nil).count) of \(options.target)"], highlighted: false, scoreLine: false)
            }
            ForEach(session.players, id: \.id) { player in
                let active = state.activePlayerID == player.id
                var lines: [String] = []
                if session.mode == .higherLower {
                    lines.append("Streak \(scores[player.id] ?? 0)")
                    if let lives = state.higherLowerLives(for: player.id), case let .higherLower(options) = session.options, !state.eliminated.contains(player.id) {
                        lines.append("Lives \(lives) of \(options.startingLives)")
                    }
                } else if session.mode != .relay {
                    lines.append(scoreText(scores[player.id] ?? 0, mode: session.mode, stakes: session.options.stakes))
                }
                if let chips = state.chips(for: player.id) { lines.append("Chips \(chips)") }
                if case let .timeline(options) = session.options, options.challenges, let tokens = state.tokens(for: player.id) { lines.append("Tokens \(tokens)") }
                if state.eliminated.contains(player.id) { lines.append("Out") }
                return cell(title: player.name, lines: lines, highlighted: active, scoreLine: session.mode != .relay, active: active ? (session.mode == .relay ? "Voice: \(player.name)" : "\(player.name)'s turn") : nil)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Stage.ink.opacity(0.92))
    }

    private func cell(title: String, lines: [String], highlighted: Bool, scoreLine: Bool, active: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline)
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                if index == 0, scoreLine {
                    Text(line).font(.title2.weight(.bold)).monospacedDigit()
                } else {
                    Text(line).font(.callout)
                }
            }
            if let active { Text(active).font(.callout.weight(.semibold)) }
        }
        .foregroundStyle(Stage.paper)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 10).strokeBorder(highlighted ? Stage.paper : Color(hex: "#7A7085"), lineWidth: highlighted ? 2.5 : 1))
        .accessibilityElement(children: .combine)
    }
}
