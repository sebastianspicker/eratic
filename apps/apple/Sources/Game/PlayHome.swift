import SwiftUI
import EraticCore

/// Play home: resume, playback, Daily Eratic and the mode gallery. The host screen replaces it during a game.
struct PlayHome: View {
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore
    @EnvironmentObject private var playback: PlaybackHub

    var body: some View {
        if game.isHosting, game.session != nil {
            HostView()
        } else {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let notice = game.storeNotice {
                            Label(notice, systemImage: "exclamationmark.triangle").font(.callout)
                        }
                        if let error = game.lastError {
                            Text(error).foregroundStyle(.red).font(.callout)
                        }
                        if game.canReturn { ResumeBanner() }
                        PlaybackPanel()
                        DailyCard()
                        ModeGallery()
                    }
                    .padding(24)
                    .frame(maxWidth: 980, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .background(Stage.paper)
                .navigationTitle("Play")
                .navigationDestination(for: GameMode.self) { mode in SetupView(mode: mode) }
            }
            .task { try? deckStore.loadSampleIfNeeded() }
        }
    }
}

/// A white panel on the paper stage.
struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.bold())
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct ResumeBanner: View {
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore
    @State private var confirmDiscard = false

    var body: some View {
        if let session = game.session, let state = game.state {
            // The loaded deck when it matches, otherwise the copy saved with the game.
            let deckAvailable = game.deck(loaded: deckStore.deck) != nil
            let finished = state.phase == .finished
            Panel(title: finished ? "Results waiting" : "Game in progress") {
                Text("\(session.mode.name) · \(namesList(session.players.map(\.name))) · " + (finished ? "game over" : "round \(state.round + 1)"))
                if !deckAvailable {
                    Text("Load the deck “\(session.deckTitle)” in the Deck tab to resume.").foregroundStyle(.secondary)
                }
                HStack {
                    Button("Resume") { game.resume() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!deckAvailable)
                    Button("Discard", role: .destructive) { confirmDiscard = true }
                }
            }
            .confirmationDialog("Discard the saved game?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard game", role: .destructive) { game.discard() }
            } message: {
                Text("The \(session.mode.name) game can't be resumed afterwards.")
            }
        }
    }
}

private struct PlaybackPanel: View {
    @EnvironmentObject private var playback: PlaybackHub
    @State private var choice = PlaybackProvider.manual
    @State private var showCalibration = false
    @State private var lastCalibration: CalibrationResult?

    var body: some View {
        Panel(title: "Playback") {
            Picker("Music from", selection: $choice) {
                ForEach(PlaybackProvider.allCases) { provider in Text(provider.pickerLabel).tag(provider) }
            }
            .disabled(playback.status == .connecting)
            HStack {
                Button(playback.status == .connecting ? "Connecting…" : "Use playback") {
                    Task { await playback.connect(choice) }
                }
                .disabled(playback.status == .connecting)
                Text(tierDescription(provider: playback.provider, tier: playback.tier, status: playback.status))
                    .font(.callout.weight(.medium))
            }
            if choice == .spotify, AppConfig.spotifyClientID != nil,
               !(playback.provider == .spotify && playback.tier.exactClips) {
                Button("Enable timed clips") { Task { await playback.connect(.spotify, authorize: true) } }
                    .disabled(playback.status == .connecting)
            }
            Text(choice == .appleMusic
                 ? "Uses Apple Music on this device. Allow music access to use your subscription."
                 : "Song links open in your music app using its existing account. Spotify Free works with manual playback.")
                .font(.caption).foregroundStyle(.secondary)
            if let error = playback.error {
                Text(error.localizedDescription).foregroundStyle(.red).font(.callout)
            }
            if playback.tier.exactClips {
                Button("Calibrate timing") { showCalibration = true }
                Text(calibrationText).font(.caption).foregroundStyle(.secondary)
            }
        }
        .onAppear {
            choice = playback.provider
            lastCalibration = CalibrationRun.latest(for: playback.provider)
        }
        .onChange(of: playback.provider) { lastCalibration = CalibrationRun.latest(for: playback.provider) }
        .sheet(isPresented: $showCalibration, onDismiss: { lastCalibration = CalibrationRun.latest(for: playback.provider) }) {
            CalibrationSheet()
        }
    }

    private var calibrationText: String {
        guard let result = lastCalibration else { return "Not calibrated yet. Snippet Ladder will warn until it is." }
        let date = result.date.formatted(date: .abbreviated, time: .shortened)
        // An unknown stop position is recorded as Int.max (CalibrationRun).
        if result.maxStopErrorMs == Int.max { return "Last calibration \(date): failed, a stop position couldn't be read." }
        return result.passed
            ? "Last calibration \(date): passed, start delay \(result.medianLatencyMs) ms, stop within \(result.maxStopErrorMs) ms."
            : "Last calibration \(date): failed, stops were up to \(result.maxStopErrorMs) ms off."
    }
}

/// Ledger Q4: times five short clips on the first card the provider can play.
private struct CalibrationSheet: View {
    @EnvironmentObject private var playback: PlaybackHub
    @EnvironmentObject private var deckStore: DeckStore
    @StateObject private var run = CalibrationRun()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let track = deckStore.deck?.cards.lazy.compactMap { playback.track(for: $0) }.first
        NavigationStack {
            Form {
                Section {
                    Text("Eratic plays \(CalibrationRun.trialCount) one-second clips and checks that each stops within \(CalibrationRun.toleranceMs) ms.")
                    if track == nil { Text("No card in this deck has a \(playback.provider.label) link to play.").foregroundStyle(.secondary) }
                    Button(run.isRunning ? "Calibrating…" : "Start") {
                        if let track { run.start(player: playback.player, track: track) }
                    }
                    .disabled(track == nil || run.isRunning)
                }
                if !run.trials.isEmpty {
                    Section("Trials") {
                        ForEach(Array(run.trials.enumerated()), id: \.offset) { index, trial in
                            Text("Clip \(index + 1): started after \(trial.startLatencyMs) ms, " + (trial.stopErrorMs == Int.max ? "stop unknown" : "stopped \(trial.stopErrorMs) ms off"))
                        }
                    }
                }
                if let result = run.result {
                    Section { Text(result.passed ? "Passed: clips are timed exactly." : "Failed: clip timing is not exact on this device.") }
                }
                if let error = run.error { Section { Text(error.localizedDescription).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            .navigationTitle("Calibrate timing")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        run.cancel()
                        dismiss()
                    }
                }
            }
        }
        #if os(macOS)
        .frame(width: 480, height: 420)
        #endif
    }
}

private struct DailyCard: View {
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore

    var body: some View {
        Panel(title: GameMode.daily.name) {
            if let deck = deckStore.deck {
                if let record = game.dailyPlayedToday(deck: deck) {
                    DailyResult(score: record.lastScore, shareText: record.shareText, streak: record.streak)
                } else {
                    Text(GameMode.daily.pitch)
                    Text("Today's round is ready. Streak: \(game.currentDailyStreak)").font(.callout).foregroundStyle(.secondary)
                    DailyStartButton(deck: deck, title: "Play today's round")
                        .buttonStyle(.borderedProminent)
                }
            } else {
                Text("Load a deck in the Deck tab first.").foregroundStyle(.secondary)
            }
        }
    }
}

private struct ModeGallery: View {
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore
    @EnvironmentObject private var playback: PlaybackHub

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Modes").font(.title2.bold())
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 16)], spacing: 16) {
                ForEach(GameMode.allCases, id: \.self) { mode in
                    tile(mode, ModeAvailability(mode: mode, deck: deckStore.deck, tier: playback.tier))
                }
            }
        }
    }

    private func tile(_ mode: GameMode, _ availability: ModeAvailability) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(availability.title).font(.headline)
            Text(mode.pitch).font(.callout)
            Text(mode.playerRangeText).font(.caption).foregroundStyle(.secondary)
            ForEach(availability.reasons, id: \.self) { reason in
                Label(reason, systemImage: "info.circle").font(.caption.weight(.semibold))
            }
            Spacer(minLength: 0)
            if mode == .daily {
                if let deck = deckStore.deck {
                    DailyStartButton(deck: deck, title: "Start")
                        .disabled(!availability.canStart || game.dailyPlayedToday(deck: deck) != nil)
                } else {
                    Button("Start") {}.disabled(true)
                }
            } else {
                NavigationLink("Set up", value: mode)
                    .disabled(!availability.canStart)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 170, alignment: .topLeading)
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }
}

/// Starts today's Daily Eratic, asking first when it would replace an unfinished saved game (as Setup says);
/// when that game is today's Daily, it offers *Resume* instead.
private struct DailyStartButton: View {
    let deck: Deck
    let title: String
    @EnvironmentObject private var game: GameController
    @State private var confirmReplace = false

    var body: some View {
        if game.unfinishedDailyToday(deck: deck) {
            Button("Resume today's round") { game.resume() }
        } else {
            Button(title) {
                if game.resumable { confirmReplace = true } else { game.startDaily(deck: deck) }
            }
            .confirmationDialog("Replace the unfinished game?", isPresented: $confirmReplace, titleVisibility: .visible) {
                Button("Replace", role: .destructive) { game.startDaily(deck: deck) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Starting today's round replaces the unfinished saved game.")
            }
        }
    }
}
