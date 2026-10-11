import SwiftUI
import EraticCore
#if os(iOS)
import UIKit
#endif

/// Snippet Ladder: play the steps one by one, players lock in at the current step, then the host shows the answer,
/// marks title and artist per locked player and scores the card. Space plays the next step.
struct LadderInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    let options: LadderOptions
    let card: CardRef
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var playback: PlaybackHub
    @State private var current: String?
    @State private var year = 1990
    @State private var wagers: [String: Int] = [:]
    @State private var showAnswer = false
    @State private var titleMarks: [String: Bool] = [:]
    @State private var artistMarks: [String: Bool] = [:]
    @State private var playError: String?
    /// Preparing a step's track; the step is recorded only once its clip is audible.
    @State private var prepareTask: Task<Void, Never>?

    private var step: Int { state.ladderStep }
    /// A step is preparing or starting: Space and the step buttons wait, so one press plays one step.
    private var busy: Bool { prepareTask != nil || clip.state == .starting }
    private var last: Int { options.steps.count - 1 }
    private var song: SongCard? { deck.card(card.cardId) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            warnings
            StepBar(steps: options.steps, current: step)
            stepControls
            if let message = playError ?? clip.error?.localizedDescription { Text(message).foregroundStyle(.red).font(.callout) }
            if step >= 0, !showAnswer {
                locks
                if session.options.stakes { wagerRows }
            }
            if showAnswer {
                answer
            } else if step >= 0 {
                let ready = session.players.allSatisfy { state.locks[$0.id] != nil } || step == last
                let owed = session.players.filter { state.owesWager($0.id) }
                Button("Show answer") { showAnswer = true }
                    .buttonStyle(.borderedProminent)
                    .disabled(!ready || !owed.isEmpty)
                if !ready {
                    Text("Show answer opens when everyone has locked in or the last step has played.").font(.caption).foregroundStyle(.secondary)
                } else if !owed.isEmpty {
                    Text("Still to wager: \(namesList(owed.map { $0.name }))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .onDisappear {
            prepareTask?.cancel()
            prepareTask = nil
        }
    }

    // MARK: Steps

    @ViewBuilder
    private var warnings: some View {
        if !playback.tier.exactClips {
            Label("Snippet Ladder needs exact clips. Connect Spotify Premium or Apple Music in Play home.", systemImage: "exclamationmark.triangle")
                .font(.callout)
        } else if CalibrationRun.latest(for: playback.provider)?.passed != true {
            Label("Timing isn't calibrated, or the last calibration failed: steps may run a little long or short. Calibrate in Play home.", systemImage: "exclamationmark.triangle")
                .font(.caption)
        }
    }

    private var stepControls: some View {
        HStack(spacing: 12) {
            if step < last {
                Button(step < 0 ? "Play \(secondsText(options.steps[0]))" : "Next: \(secondsText(options.steps[step + 1]))") { play(step + 1) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.space, modifiers: [])
                    .disabled(showAnswer || busy)
            }
            if step >= 0 {
                Button("Replay step") { play(step) }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(busy)
            }
            if prepareTask != nil, !ExactClip.isPlaying(clip) {
                Text("Preparing…").font(.callout)
            } else if let status = ExactClip.statusText(clip) {
                HStack(spacing: 6) {
                    if case .playing = clip.state { Circle().fill(.red).frame(width: 10, height: 10).accessibilityHidden(true) }
                    Text(status).font(.callout.monospacedDigit())
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// The card's start, else the deck default, else the session's choice.
    private func startMs(_ song: SongCard) -> Int {
        deck.clipStartMs(for: song) ?? (options.clipStart == .skipIntro ? 15_000 : 0)
    }

    /// The `step` action is dispatched by the host screen once the clip is audible; a clip that fails leaves the step unplayed.
    private func play(_ index: Int) {
        guard let song, !busy else { return }
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
        playError = nil
        let from = startMs(song)
        let length = options.steps[index]
        prepareTask = Task {
            let error = await ExactClip.play(song, fromMs: from, lengthMs: length, playback: playback, clip: clip, game: game,
                                             recordFirst: [.step(index: index)])
            guard !Task.isCancelled else { return }
            playError = error
            prepareTask = nil
        }
    }

    // MARK: Locks and wagers

    private var locks: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lock in").font(.headline)
            ForEach(session.players, id: \.id) { player in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(player.name).font(.headline)
                        Spacer()
                        if let lock = state.locks[player.id] {
                            Label("Locked at \(secondsText(options.steps[lock.step]))", systemImage: "lock.fill").foregroundStyle(.secondary)
                        } else if options.guess == .name {
                            Button("Lock in at \(secondsText(options.steps[step]))") { game.dispatch(.lock(playerId: player.id, year: nil)) }
                                .accessibilityLabel("Lock in \(player.name) at \(secondsText(options.steps[step]))")
                        } else if current != player.id {
                            Button("Enter for \(player.name)") { current = player.id; year = 1990 }
                        }
                    }
                    if options.guess != .name, current == player.id, state.locks[player.id] == nil {
                        YearField(label: "\(player.name)'s year", year: $year)
                        Button("Lock in at \(secondsText(options.steps[step]))") {
                            guard game.dispatch(.lock(playerId: player.id, year: year)) else { return }
                            current = nil
                            year = 1990
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding(12)
                .background(Color.secondary.opacity(current == player.id ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var wagerRows: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Wagers").font(.headline)
            ForEach(session.players, id: \.id) { player in
                let held = state.chips(for: player.id) ?? 0
                VStack(alignment: .leading, spacing: 4) {
                    Text(player.name).font(.callout.weight(.semibold))
                    if let placed = state.wagers[player.id] {
                        Text("Wagered \(placed)").font(.callout)
                    } else {
                        WagerControl(held: held, wager: Binding(get: { wagers[player.id] ?? 1 }, set: { wagers[player.id] = $0 }))
                        if state.owesWager(player.id) {
                            Button("Wager for \(player.name)") {
                                game.dispatch(.wager(playerId: player.id, chips: min(wagers[player.id] ?? 1, min(3, held))))
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Answer and scoring

    private var answer: some View {
        let locked = session.players.filter { state.locks[$0.id] != nil }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Answer (host only)").font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                YearChip(year: card.year)
                VStack(alignment: .leading, spacing: 2) {
                    Text(song?.title ?? card.cardId).font(.title3.bold())
                    if let song { Text(song.artist).font(.callout) }
                }
            }
            if options.guess != .year {
                if locked.isEmpty {
                    Text("Nobody locked in.").font(.callout)
                }
                ForEach(locked, id: \.id) { player in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.name).font(.headline)
                        Toggle("Title right", isOn: Binding(get: { titleMarks[player.id] ?? false }, set: { titleMarks[player.id] = $0 }))
                            .accessibilityLabel("\(player.name): title right")
                        Toggle("Artist right", isOn: Binding(get: { artistMarks[player.id] ?? false }, set: { artistMarks[player.id] = $0 }))
                            .accessibilityLabel("\(player.name): artist right")
                    }
                }
            }
            Button("Score card") { score(locked) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(14)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
    }

    private func score(_ locked: [SessionPlayer]) {
        if options.guess != .year {
            for player in locked where state.marks[player.id] == nil {
                guard game.dispatch(.mark(playerId: player.id, titleOK: titleMarks[player.id] ?? false, artistOK: artistMarks[player.id] ?? false)) else { return }
            }
        }
        clip.cancel()
        game.dispatch(.reveal)
    }
}

/// The steps as a bar ("1 s · 5 s · 10 s · 30 s · 60 s"): played steps filled, the current one lit.
struct StepBar: View {
    let steps: [Int]
    /// The step played last, −1 before the first.
    let current: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, ms in
                let played = index <= current
                let lit = index == current
                Text(secondsText(ms))
                    .font(.callout.weight(lit ? .heavy : .semibold).monospacedDigit())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(minWidth: 52)
                    .foregroundStyle(played ? Stage.paper : Color.primary)
                    .background(Capsule().fill(played ? Stage.ink : Color.secondary.opacity(0.08)))
                    .overlay(Capsule().strokeBorder(lit ? Color(hex: "#8A90FF") : Color(hex: "#8A8072"), lineWidth: lit ? 3 : 1))
                    .accessibilityLabel("Step \(index + 1) of \(steps.count), \(secondsText(ms)), " + (lit ? "current" : played ? "played" : "not played yet"))
            }
        }
        .accessibilityElement(children: .contain)
    }
}
