import AVFoundation
import SwiftUI
import EraticCore

/// Players, the mode's options with the contract defaults, card source and *Start*.
struct SetupView: View {
    let mode: GameMode
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var deckStore: DeckStore
    @EnvironmentObject private var playback: PlaybackHub
    @State private var players: [PlayerEntry]
    @State private var options: GameOptions
    @State private var easyOnly = false
    @State private var kids = false
    @State private var cardSource: CardSource
    private let hasCamera = AVCaptureDevice.default(for: .video) != nil

    private struct PlayerEntry: Identifiable {
        let id = UUID()
        var name: String
    }

    init(mode: GameMode) {
        self.mode = mode
        let range = mode.playerRange
        let count = max(range.lowerBound, min(2, range.upperBound))
        _players = State(initialValue: (1...count).map { PlayerEntry(name: "Player \($0)") })
        _options = State(initialValue: SetupView.defaults(mode))
        #if os(macOS)
        _cardSource = State(initialValue: .draw)
        #else
        _cardSource = State(initialValue: AVCaptureDevice.default(for: .video) != nil ? .scan : .draw)
        #endif
    }

    /// The contract defaults; Daily's options are built from today's date when it starts.
    static func defaults(_ mode: GameMode) -> GameOptions {
        switch mode {
        case .ladder: return .ladder(LadderOptions())
        case .timeline: return .timeline(TimelineOptions())
        case .bullseye: return .bullseye(BullseyeOptions())
        case .eraSort: return .eraSort(EraSortOptions())
        case .higherLower: return .higherLower(HigherLowerOptions())
        case .relay: return .relay(RelayOptions())
        case .lineup: return .lineup(LineupOptions())
        case .daily: return .daily(DailyOptions(date: GameController.todayUTC(), cards: []))
        case .imposter: return .imposter(ImposterOptions())
        }
    }

    var body: some View {
        let range = mode.playerRange
        Form {
            Section {
                ForEach($players) { $player in
                    HStack {
                        TextField("Name", text: $player.name)
                        Button(role: .destructive) {
                            players.removeAll { $0.id == player.id }
                        } label: {
                            Label("Remove", systemImage: "minus.circle")
                        }
                        .labelStyle(.iconOnly)
                        .disabled(players.count <= range.lowerBound)
                        .accessibilityLabel("Remove \(player.name)")
                    }
                }
                Button {
                    players.append(PlayerEntry(name: "Player \(players.count + 1)"))
                } label: {
                    Label("Add player", systemImage: "plus.circle")
                }
                .disabled(players.count >= range.upperBound)
            } header: {
                Text("Players (\(mode.playerRangeText))")
            } footer: {
                Text("Names stay on this device.")
            }
            if mode == .timeline {
                Section {
                    Toggle("Kids", isOn: Binding(get: { kids }, set: { on in
                        kids = on
                        // Kids only presets options: Beginning anchor, no challenges.
                        if on, case var .timeline(timeline) = options {
                            timeline.anchor = .beginning
                            timeline.anchorYear = nil
                            timeline.challenges = false
                            options = .timeline(timeline)
                        }
                    }))
                } footer: {
                    Text("Starts from the earliest songs, turns challenges off and uses larger controls. You can still change the options below.")
                }
            }
            Section("Options") {
                ModeOptionsEditor(options: $options, defaultYear: medianYear)
            }
            // Daily Eratic always selects from the whole deck, so everyone gets the same songs.
            if mode != .daily, deckStore.deck?.cards.contains(where: { $0.difficulty != nil }) == true {
                Section {
                    Toggle("Easy cards only", isOn: $easyOnly)
                } footer: {
                    Text("Draws only cards with difficulty 1 or 2.")
                }
            }
            Section("Cards") {
                Picker("Card source", selection: $cardSource) {
                    if hasCamera { Text(CardSource.scan.label).tag(CardSource.scan) }
                    Text(CardSource.draw.label).tag(CardSource.draw)
                }
                if !hasCamera { Text("No camera found, so cards are drawn from the deck.").font(.caption).foregroundStyle(.secondary) }
            }
            Section {
                if game.resumable { Text("Starting replaces the unfinished saved game.").font(.callout).foregroundStyle(.secondary) }
                if let error = game.lastError { Text(error).foregroundStyle(.red) }
                Button("Start") { start() }
                    .buttonStyle(.borderedProminent)
                    .disabled(deckStore.deck == nil)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(ModeAvailability(mode: mode, deck: deckStore.deck, tier: playback.tier).title)
        .onAppear { game.lastError = nil }
    }

    private func start() {
        guard let deck = deckStore.deck else { return }
        let sessionPlayers = players.enumerated().map { index, entry in
            SessionPlayer(id: "p\(index + 1)", name: SetupView.cleanName(entry.name, fallback: "Player \(index + 1)"))
        }
        var chosen = options
        // A preview-only account drops the steps longer than its preview (game-rules.md 6.4).
        if case var .ladder(ladder) = chosen, case let .previewOnly(maxMs) = playback.tier {
            let kept = ladder.steps.filter { $0 <= maxMs }
            if !kept.isEmpty { ladder.steps = kept }
            chosen = .ladder(ladder)
        }
        game.start(options: chosen, players: sessionPlayers, deck: deck, cardSource: hasCamera ? cardSource : .draw, easyOnly: easyOnly && mode != .daily, kids: kids)
    }

    /// The loaded deck's median curated year, the default for a custom anchor year.
    private var medianYear: Int {
        let years = (deckStore.deck?.cards.map(\.gameYear.value) ?? []).sorted()
        return years.isEmpty ? 1980 : years[years.count / 2]
    }

    /// Trimmed, at most 40 code points, never blank.
    static func cleanName(_ name: String, fallback: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return fallback }
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: trimmed.unicodeScalars.prefix(40))
        return String(scalars)
    }
}

/// Native controls for every mode's options, in plain words, within the contract ranges.
struct ModeOptionsEditor: View {
    @Binding var options: GameOptions
    /// The year a custom anchor starts at.
    var defaultYear = 1980

    var body: some View {
        switch options {
        case let .bullseye(value):
            let o = bind(value) { .bullseye($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...100)
            Toggle("Stakes: wager chips on each guess", isOn: o.stakes)
        case let .eraSort(value):
            let o = bind(value) { .eraSort($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...100)
            Toggle("Kids: neighbouring eras score full points", isOn: o.kids)
        case let .timeline(value):
            let o = bind(value) { .timeline($0) }
            Picker("Timelines", selection: o.ownership) {
                Text("One per player").tag(TimelineOwnership.personal)
                Text("One shared line").tag(TimelineOwnership.shared)
            }
            AnchorPicker(choice: anchorBinding(get: { ($0.anchor, $0.anchorYear) }, set: { $0.anchor = $1.kind; $0.anchorYear = $1.year }, wrap: GameOptions.timeline) {
                if case let .timeline(current) = $0 { return current }
                return nil
            }, defaultYear: defaultYear)
            Stepper("First to \(value.target) cards", value: o.target, in: 2...30)
            Toggle("Challenges", isOn: o.challenges)
            Stepper("Tokens per player: \(value.tokens)", value: o.tokens, in: 0...5)
            Toggle("Name It: name the song to earn a token", isOn: o.nameIt)
            Toggle("Stakes: wager chips on each placement", isOn: o.stakes)
            Picker("Clip", selection: o.clip) {
                Text("Full song").tag(TimelineClip.full)
                Text("30 seconds").tag(TimelineClip.thirtySeconds)
                Text("10 seconds").tag(TimelineClip.tenSeconds)
            }
        case let .ladder(value):
            let o = bind(value) { .ladder($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...100)
            Picker("Guess", selection: o.guess) {
                Text("Title and artist").tag(LadderGuess.name)
                Text("Year").tag(LadderGuess.year)
                Text("Both").tag(LadderGuess.both)
            }
            Picker("Clip start", selection: o.clipStart) {
                Text("The card's start").tag(LadderClipStart.card)
                Text("Skip the intro").tag(LadderClipStart.skipIntro)
                Text("From the beginning").tag(LadderClipStart.zero)
            }
            Text("Steps: " + value.steps.map { "\($0 / 1000) s" }.joined(separator: " · ")).foregroundStyle(.secondary)
            Toggle("Stakes: wager chips on each song", isOn: o.stakes)
        case let .higherLower(value):
            let o = bind(value) { .higherLower($0) }
            Stepper("Versus ends after \(value.cards) cards", value: o.cards, in: 2...100)
            Text("Solo play goes on until the first miss.").font(.caption).foregroundStyle(.secondary)
        case let .relay(value):
            let o = bind(value) { .relay($0) }
            Stepper("Line of \(value.target) cards wins", value: o.target, in: 2...30)
            Stepper("Lives: \(value.lives)", value: o.lives, in: 1...10)
            AnchorPicker(choice: anchorBinding(get: { ($0.anchor, $0.anchorYear) }, set: { $0.anchor = $1.kind; $0.anchorYear = $1.year }, wrap: GameOptions.relay) {
                if case let .relay(current) = $0 { return current }
                return nil
            }, defaultYear: defaultYear)
            Toggle("Name It: name the song to win back a life", isOn: o.nameIt)
        case let .lineup(value):
            let o = bind(value) { .lineup($0) }
            Stepper("Songs per lineup: \(value.k)", value: o.k, in: 3...5)
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...20)
            Stepper("Clip length: \(value.clipMs / 1000) s", value: o.clipMs, in: 1000...60_000, step: 1000)
        case .daily:
            Text("Five songs: three eras, then two years. Everyone gets the same songs today.").foregroundStyle(.secondary)
        case let .imposter(value):
            let o = bind(value) { .imposter($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...50)
        }
    }

    private func bind<T>(_ value: T, _ wrap: @escaping (T) -> GameOptions) -> Binding<T> {
        Binding(get: { value }, set: { options = wrap($0) })
    }

    /// The anchor kind and year as one value, read from and written to the current options in a single assignment.
    private func anchorBinding<T>(get: @escaping (T) -> (AnchorKind, Int?), set: @escaping (inout T, AnchorChoice) -> Void,
                                  wrap: @escaping (T) -> GameOptions, extract: @escaping (GameOptions) -> T?) -> Binding<AnchorChoice> {
        Binding(get: {
            guard let current = extract(options) else { return AnchorChoice(kind: .beginning, year: nil) }
            let (kind, year) = get(current)
            return AnchorChoice(kind: kind, year: year)
        }, set: { choice in
            guard var current = extract(options) else { return }
            set(&current, choice)
            options = wrap(current)
        })
    }
}

/// An anchor kind with its year, changed together.
struct AnchorChoice: Equatable {
    var kind: AnchorKind
    var year: Int?
}

/// Anchor kind with a year only for *custom* (the engine forbids it otherwise).
private struct AnchorPicker: View {
    @Binding var choice: AnchorChoice
    let defaultYear: Int

    var body: some View {
        Picker("First card", selection: Binding(get: { choice.kind }, set: { newValue in
            choice = AnchorChoice(kind: newValue, year: newValue == .custom ? (choice.year ?? defaultYear) : nil)
        })) {
            Text("From the earliest songs").tag(AnchorKind.beginning)
            Text("From the middle").tag(AnchorKind.middle)
            Text("Any song").tag(AnchorKind.random)
            Text("Closest to a year").tag(AnchorKind.custom)
        }
        if choice.kind == .custom {
            YearField(label: "Anchor year", year: Binding(get: { choice.year ?? defaultYear }, set: { choice = AnchorChoice(kind: .custom, year: $0) }))
        }
    }
}
