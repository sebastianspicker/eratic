import SwiftUI
import EraticCore
#if os(iOS)
import UIKit
#endif

/// Snippet Ladder: play the steps one by one, players lock in at the current step, then the host shows the answer,
/// marks title and artist per locked player and scores the card. Space plays the next step. Without exact clips the
/// steps play from the song's hidden provider preview and stop by themselves; with no usable preview the host plays
/// each step by hand (QR) and marks it played.
struct LadderInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    let options: LadderOptions
    let card: CardRef
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var playback: PlaybackHub
    /// The hidden preview that plays the steps when there are no exact clips.
    @StateObject private var snippets = SnippetController()
    @State private var current: String?
    @State private var year = ""
    @State private var yearError: String?
    /// The host's ±5 s nudge of the exact clip's start, for this card only.
    @State private var nudgeMs = 0
    @State private var wagers: [String: Int] = [:]
    @State private var showAnswer = false
    @State private var titleMarks: [String: Bool] = [:]
    @State private var artistMarks: [String: Bool] = [:]
    @State private var playError: String?
    /// Preparing a step's track; the step is recorded only once its clip is audible.
    @State private var prepareTask: Task<Void, Never>?
    /// Starting an exact step remounts the backup's preview, which stops it.
    @State private var previewRevision = UUID()

    private var step: Int { state.ladderStep }
    /// A step is preparing or starting: Space and the step buttons wait, so one press plays one step.
    private var busy: Bool { prepareTask != nil || clip.state == .starting || (snippetMode && !snippets.canPlay) }
    /// The answer is shown, or a step is preparing, starting or playing: the host screen hides Undo.
    private var undoLocked: Bool {
        showAnswer || prepareTask != nil || ExactClip.isPlaying(clip) || clip.state == .starting
            || snippets.status == "starting" || snippets.status == "playing"
    }
    private var last: Int { options.steps.count - 1 }
    private var song: SongCard? { deck.card(card.cardId) }
    /// The card's Spotify or Apple Music link, the only source of a snippet without exact clips.
    private var snippetURL: URL? {
        guard !playback.tier.exactClips, let song,
              let url = SongBackup.backupURL(for: song, provider: playback.provider),
              ScanRules.providerTrack(url.absoluteString) != nil else { return nil }
        return url
    }
    /// Steps play from the hidden preview; otherwise (no link, or the preview is unavailable) the host marks them by hand.
    private var snippetMode: Bool { snippetURL != nil && !snippets.failed }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            warnings
            StepBar(steps: options.steps, current: step)
            stepControls
            if let snippetURL { SnippetPreview(controller: snippets, url: snippetURL) }
            if let song { SongBackup(card: song, collapsed: snippetMode || (playback.tier.exactClips && playback.track(for: song) != nil), previewID: previewRevision) }
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
                Button("Show answer") {
                    prepareTask?.cancel()
                    prepareTask = nil
                    clip.cancel()
                    snippets.stop()
                    previewRevision = UUID()
                    showAnswer = true
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(!ready || !owed.isEmpty)
                if !ready {
                    Text("Show answer opens when everyone has locked in or the last step has played.").font(.caption).foregroundStyle(.secondary)
                } else if !owed.isEmpty {
                    Text("Still to wager: \(namesList(owed.map { $0.name }))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .onChange(of: card.cardId) { nudgeMs = 0 }
        .onChange(of: undoLocked) { game.ladderBusy = undoLocked }
        .onAppear { game.ladderBusy = undoLocked }
        .onDisappear {
            game.ladderBusy = false
            prepareTask?.cancel()
            prepareTask = nil
        }
    }

    // MARK: Steps

    @ViewBuilder
    private var warnings: some View {
        if snippetMode {
            Label("Snippets play from the song's preview and stop by themselves.", systemImage: "info.circle")
                .font(.callout)
        } else if !playback.tier.exactClips {
            if snippets.failed {
                Text(snippets.status == "unavailable" ? "No hidden preview is available for this song." : "The preview could not play.")
                    .font(.callout)
            }
            Label("Without exact clips, play each step by hand with the preview or QR, then mark it played.", systemImage: "exclamationmark.triangle")
                .font(.callout)
        } else if CalibrationRun.latest(for: playback.provider)?.passed != true {
            Label("Timing isn't calibrated, or the last calibration failed: steps may run a little long or short. Calibrate in Play home.", systemImage: "exclamationmark.triangle")
                .font(.caption)
        }
    }

    private var stepControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            stepButtons
            if playback.tier.exactClips, let song { nudgeControl(start: startMs(song)) }
        }
    }

    /// "−5 s", "Starts at 0:45", "+5 s": the start of this card's exact clips, 5 s at a time, never before 0:00.
    private func nudgeControl(start: Int) -> some View {
        HStack(spacing: 12) {
            Button("−5 s") { nudgeMs = max(nudgeMs - 5000, nudgeMs - start) }
                .accessibilityLabel("Start 5 seconds earlier")
                .disabled(start == 0)
            Text("Starts at \(Self.clock(start))").font(.callout.monospacedDigit())
            Button("+5 s") { nudgeMs += 5000 }
                .accessibilityLabel("Start 5 seconds later")
        }
        .buttonStyle(.bordered)
        .accessibilityElement(children: .contain)
    }

    private static func clock(_ ms: Int) -> String {
        String(format: "%d:%02d", ms / 60_000, (ms % 60_000) / 1000)
    }

    private var stepButtons: some View {
        HStack(spacing: 12) {
            if step < last {
                Button(nextLabel) { play(step + 1) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    // Only timed steps: a stray Space must not mark a step played by hand.
                    .keyboardShortcut(playback.tier.exactClips || snippetMode ? KeyboardShortcut(.space, modifiers: []) : nil)
                    .disabled(showAnswer || busy)
            }
            if step >= 0, playback.tier.exactClips || snippetMode {
                Button("Replay \(secondsText(options.steps[step]))") { play(step) }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(showAnswer || busy)
            }
            if playback.tier.exactClips, ExactClip.isPlaying(clip) {
                Button("Stop") { clip.cancel() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
            }
            if snippetMode, snippets.status == "starting" || snippets.status == "playing" {
                Button("Stop snippet") { snippets.stop() }
                    .buttonStyle(.bordered)
            }
            if snippetMode, !snippets.canPlay {
                Text(snippets.status == "loading" ? "Loading preview…" : "Starting…").font(.callout)
            } else if prepareTask != nil, !ExactClip.isPlaying(clip) {
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

    private var nextLabel: String {
        let seconds = secondsText(options.steps[step + 1])
        if playback.tier.exactClips || snippetMode { return step < 0 ? "Play \(seconds)" : "More time: \(seconds)" }
        return step < 0 ? "Mark \(seconds) played" : "Next: mark \(seconds) played"
    }

    /// The card's start, else the deck default, else the session's choice, plus the host's nudge for this card.
    private func startMs(_ song: SongCard) -> Int {
        max(0, (deck.clipStartMs(for: song) ?? (options.clipStart == .skipIntro ? 15_000 : 0)) + nudgeMs)
    }

    /// With exact clips the `step` action is dispatched by the host screen once the clip is audible; a clip that fails leaves the step unplayed.
    private func play(_ index: Int) {
        guard !showAnswer, !busy else { return }
        // Nothing to time or hear: the host played the step by hand.
        guard playback.tier.exactClips else {
            if snippetMode {
                // The step is recorded once its sound starts, and only if the same card is still in play.
                previewRevision = UUID()
                let key = game.playKey
                snippets.snippet(from: 0, lengthMs: options.steps[index]) {
                    guard game.playKey == key else { return }
                    game.dispatch(.step(index: index))
                }
            } else {
                game.dispatch(.step(index: index))
            }
            return
        }
        guard let song else { return }
        previewRevision = UUID()
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
                            Button("Enter for \(player.name)") { current = player.id; year = ""; yearError = nil }
                        }
                    }
                    if options.guess != .name, current == player.id, state.locks[player.id] == nil {
                        YearEntry(label: "\(player.name)'s year", text: $year, error: yearError)
                        Button("Lock in at \(secondsText(options.steps[step]))") {
                            guard let parsed = YearEntry.parse(year) else {
                                yearError = YearEntry.errorText
                                return
                            }
                            yearError = nil
                            guard game.dispatch(.lock(playerId: player.id, year: parsed)) else { return }
                            current = nil
                            year = ""
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
        snippets.stop()
        game.dispatch(.reveal)
    }
}

/// The steps as a bar ("1 s · 5 s · 10 s · 20 s · 30 s"): played steps filled, the current one lit.
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
