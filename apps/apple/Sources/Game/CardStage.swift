import AVFoundation
import SwiftUI
import EraticCore

/// The middle of the host screen: draw or scan a card, then the mystery card with its clip controls.
struct CardStage: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @State private var showScanner = false
    @State private var scanMessage: String?
    @State private var audioOnly: (track: ProviderTrack, payload: String)?
    @State private var exhausted = false
    @State private var confirmEnd = false
    private let hasCamera = AVCaptureDevice.default(for: .video) != nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if state.phase == .awaitingDraw || state.phase == .suddenDeath {
                drawControls
            } else if let card = cardInPlay {
                MysteryCard()
                if let song = deck.card(card.cardId) {
                    // Snippet Ladder plays its steps from its own inputs.
                    if !(session.mode == .ladder && state.phase == .open) {
                        ClipPanel(card: song, deck: deck, options: session.options, lengthMs: clipLengthMs, clip: clip)
                            .id(card.cardId)
                    }
                } else {
                    Text("Card \(card.cardId) is no longer in this deck, so it can't be played.").foregroundStyle(.secondary)
                }
                // A skipped Daily card can't be replaced (game-rules.md 6.8), so Daily has no *Skip card*.
                if session.mode != .daily { skipButton }
            } else if state.phase == .open || state.phase == .suddenDeathOpen {
                let count = state.currentPair != nil ? 2 : state.currentSet.isEmpty ? state.suddenDeathInfo?.cards.count ?? 0 : state.currentSet.count
                Text(state.currentPair != nil ? "A pair is in play." : "\(count) songs are in play.").font(.headline)
                skipButton
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .sheet(isPresented: $showScanner) {
            VStack(spacing: 0) {
                ScannerView { payload in
                    // The camera may report the same code again before the sheet closes.
                    guard showScanner else { return }
                    showScanner = false
                    handleScan(payload)
                }
                Button("Cancel") { showScanner = false }.padding()
            }
            #if os(macOS)
            .frame(width: 520, height: 560)
            #endif
        }
        .confirmationDialog("End this game?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End game", role: .destructive) { game.dispatch(.end) }
        }
    }

    private var skipButton: some View {
        Button(state.currentPair != nil || !state.currentSet.isEmpty ? "Skip (a song is unavailable)" : "Skip card (song unavailable)") { game.dispatch(.skip) }
            .buttonStyle(.borderless)
            .font(.callout)
    }

    /// A 5-second clip for the first-to-name sudden death, otherwise the usual clip; nil plays untimed.
    private var clipLengthMs: Int? {
        if state.phase == .suddenDeathOpen && state.suddenDeathInfo?.kind == .firstToName { return 5_000 }
        // Timeline's clip option; "full" runs untimed until the track ends (the clip controller notices the stall).
        if case let .timeline(timeline) = session.options {
            switch timeline.clip {
            case .full: return nil
            case .thirtySeconds: return 30_000
            case .tenSeconds: return 10_000
            }
        }
        return ClipPanel.clipMs
    }

    /// The single card in play, or the single sudden-death card.
    private var cardInPlay: CardRef? {
        if let card = state.currentCard { return card }
        if state.phase == .suddenDeathOpen, let cards = state.suddenDeathInfo?.cards, cards.count == 1 { return cards[0] }
        return nil
    }

    @ViewBuilder
    private var drawControls: some View {
        if exhausted || !game.canDraw(in: deck) {
            Text("No cards left to draw.").font(.headline)
            Button("End game", role: .destructive) { confirmEnd = true }
        } else {
            HStack(spacing: 12) {
                // Sets and pairs are drawn from the deck; scanning picks one card at a time.
                let canScan = hasCamera && session.mode != .daily && game.drawCount == 1
                if game.cardSource == .scan, canScan {
                    Button("Scan card") { showScanner = true }.buttonStyle(.borderedProminent)
                    Button(drawLabel) { draw() }.buttonStyle(.bordered)
                } else {
                    Button(drawLabel) { draw() }.buttonStyle(.borderedProminent)
                    if canScan {
                        Button("Scan card") { showScanner = true }.buttonStyle(.bordered)
                    }
                }
            }
            .controlSize(.large)
        }
        if let scanMessage {
            Text(scanMessage).font(.callout)
        }
        if let audioOnly {
            VStack(alignment: .leading, spacing: 6) {
                Text("This \(audioOnly.track.provider.label) song isn't in the deck.").font(.callout)
                AudioOnlyButton(track: audioOnly.track, payload: audioOnly.payload, clip: clip)
            }
        }
    }

    private var drawLabel: String {
        if session.mode == .imposter, state.phase == .awaitingDraw { return "Draw pair" }
        if let count = game.drawCount, count > 1 { return "Draw \(count) cards" }
        return "Draw card"
    }

    private func draw() {
        scanMessage = nil
        audioOnly = nil
        exhausted = !game.drawFromDeck(deck) && game.lastError == nil
    }

    private func handleScan(_ payload: String) {
        scanMessage = nil
        audioOnly = nil
        switch game.resolveScan(payload, deck: deck) {
        case let .draw(card): game.play([card])
        case let .message(text): scanMessage = text
        case let .audioOnly(track, payload): audioOnly = (track, payload)
        }
    }
}

/// The card's back: the stage colour and a question mark, so nobody sees the answer early.
private struct MysteryCard: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("?").font(.system(size: 64, weight: .heavy, design: .rounded))
            Text("Mystery card").font(.callout.weight(.semibold))
        }
        .foregroundStyle(Stage.paper)
        .frame(maxWidth: .infinity, minHeight: 160)
        .background(Stage.ink, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Mystery card in play")
    }
}

/// *Play* / *Replay* with a text countdown when clips are exact, else *Play on Spotify* opens the song; either way the song's backup QR and hidden preview.
private struct ClipPanel: View {
    let card: SongCard
    let deck: Deck
    let options: GameOptions
    /// nil plays untimed (Timeline's *Full song*).
    let lengthMs: Int?
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var playback: PlaybackHub
    @EnvironmentObject private var game: GameController
    @State private var nudgeMs = 0
    @State private var played = false
    @State private var previewRevision = UUID()
    @State private var playError: String?
    /// Preparing the track; Play is disabled until the clip starts or preparing fails.
    @State private var prepareTask: Task<Void, Never>?
    static let clipMs = 30_000

    /// The card's start, else the deck default, else the session's choice; plus the host's nudge.
    private func startMs(nudge: Int) -> Int {
        var sessionChoice = 0
        if case let .ladder(ladder) = options, ladder.clipStart == .skipIntro { sessionChoice = 15_000 }
        return max(0, (deck.clipStartMs(for: card) ?? sessionChoice) + nudge)
    }

    /// The start and length that actually play: a preview moves the start earlier (`ExactClip.clamped`).
    private func effective(nudge: Int) -> (fromMs: Int, lengthMs: Int?) {
        ExactClip.clamped(fromMs: startMs(nudge: nudge), lengthMs: lengthMs, tier: playback.tier)
    }

    private var exactTrack: PlayableTrack? {
        playback.tier.exactClips ? playback.track(for: card) : nil
    }

    /// The song link to open when clips can't be timed: the chosen provider's, else the card's first.
    private var manualTrack: PlayableTrack? {
        if playback.provider != .manual, let track = PlayableTrack.from(card: card, provider: playback.provider) { return track }
        return PlayableTrack.from(card: card, provider: .manual)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let track = exactTrack {
                HStack(spacing: 12) {
                    Button(isPlaying ? "Stop" : played ? "Replay" : "Play") {
                        if isPlaying { clip.cancel() } else { play(track) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(prepareTask != nil)
                    indicator
                }
                // Nudges that wouldn't move the effective start are disabled.
                let start = effective(nudge: nudgeMs).fromMs
                HStack(spacing: 8) {
                    Button { nudgeMs -= 5_000 } label: { Image(systemName: "gobackward.5") }
                        .accessibilityLabel("Start 5 seconds earlier")
                        .disabled(effective(nudge: nudgeMs - 5_000).fromMs == start)
                    Text("Clip starts at \(Self.time(start))").font(.callout.monospacedDigit())
                    Button { nudgeMs += 5_000 } label: { Image(systemName: "goforward.5") }
                        .accessibilityLabel("Start 5 seconds later")
                        .disabled(effective(nudge: nudgeMs + 5_000).fromMs == start)
                }
                .buttonStyle(.bordered)
                SongBackup(card: card, collapsed: true, previewID: previewRevision)
            } else if let track = manualTrack {
                SongBackup(card: card, collapsed: false, previewID: previewRevision)
                Button("Play on \(providerName(track))") { openManually(track) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                Text("Start the song yourself; Eratic can't time clips with this playback.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("This card has no song link to play.").foregroundStyle(.secondary)
            }
            if let message = playError ?? clip.error?.localizedDescription {
                Text(message).foregroundStyle(.red).font(.callout)
            }
        }
        .onDisappear {
            prepareTask?.cancel()
            prepareTask = nil
        }
    }

    private var isPlaying: Bool {
        switch clip.state {
        case .starting, .playing: return true
        default: return false
        }
    }

    @ViewBuilder
    private var indicator: some View {
        if prepareTask != nil, clip.state == .idle || clip.state == .finished {
            Text("Preparing…").font(.callout)
        } else {
            clipIndicator
        }
    }

    @ViewBuilder
    private var clipIndicator: some View {
        switch clip.state {
        case .starting:
            Text("Starting…").font(.callout)
        case .playing:
            HStack(spacing: 6) {
                Circle().fill(.red).frame(width: 10, height: 10).accessibilityHidden(true)
                Text("Playing" + (clip.remainingMs.map { ", \(($0 + 999) / 1000) s left" } ?? "")).font(.callout.monospacedDigit())
            }
            .accessibilityElement(children: .combine)
        case .finished:
            Text("Clip finished").font(.callout)
        case .idle:
            EmptyView()
        }
    }

    private func play(_ track: PlayableTrack) {
        guard prepareTask == nil else { return }
        playError = nil
        previewRevision = UUID()
        // A preview keeps the clip's length where it can and moves the start earlier, as ExactClip does.
        let (from, length) = effective(nudge: nudgeMs)
        let player = playback.player
        // The clip only starts if this card is still in play once the track is prepared.
        let key = game.playKey
        prepareTask = Task {
            defer { if !Task.isCancelled { prepareTask = nil } }
            do {
                try await player.prepare(track)
            } catch {
                guard !Task.isCancelled, game.playKey == key else { return }
                playError = (error as? PlaybackError)?.localizedDescription ?? error.localizedDescription
                return
            }
            guard !Task.isCancelled, game.playKey == key else { return }
            clip.start(player: player, fromMs: from, lengthMs: length)
            played = true
            // Recorded by the host screen once the clip is audible.
            game.pendingClipRecords = [.clip(fromMs: from, lengthMs: length)]
        }
    }

    private func openManually(_ track: PlayableTrack) {
        previewRevision = UUID()
        let manual = ManualPlayer(openURL: { ExternalURL.open($0) })
        Task {
            do {
                try await manual.prepare(track)
                _ = try await manual.play(fromMs: 0)
                game.dispatch(.clip(fromMs: 0, lengthMs: nil))
            } catch {
                playError = (error as? PlaybackError)?.localizedDescription ?? error.localizedDescription
            }
        }
    }

    private func providerName(_ track: PlayableTrack) -> String {
        switch track.provider {
        case .spotify: return "Spotify"
        case .appleMusic: return "Apple Music"
        case .manual:
            let link = card.links.first { URL(string: $0.url) == track.url }
            return link.map { $0.provider == .other ? "the web" : $0.provider.label } ?? "the web"
        }
    }

    static func time(_ ms: Int) -> String {
        let seconds = ms / 1000
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// *Play audio only (not scored)*: plays a scanned provider link through playback without touching the session.
private struct AudioOnlyButton: View {
    let track: ProviderTrack
    let payload: String
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var playback: PlaybackHub
    @EnvironmentObject private var game: GameController
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button("Play audio only (not scored)") { play() }
                .buttonStyle(.bordered)
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
        }
    }

    private func play() {
        let provider: PlaybackProvider? = track.provider == .spotify ? .spotify : track.provider == .appleMusic ? .appleMusic : nil
        guard let provider, provider == playback.provider, playback.tier.exactClips else {
            if let url = URL(string: payload) { ExternalURL.open(url) }
            return
        }
        let playable = PlayableTrack(provider: provider, id: track.id, storefront: track.storefront, url: URL(string: payload))
        let player = playback.player
        Task {
            do {
                try await player.prepare(playable)
                clip.start(player: player, fromMs: 0, lengthMs: ClipPanel.clipMs)
                // Not scored and never recorded.
                game.pendingClipRecords = []
            } catch {
                self.error = (error as? PlaybackError)?.localizedDescription ?? error.localizedDescription
            }
        }
    }
}
