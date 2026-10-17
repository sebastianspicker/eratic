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
    @State private var confirmReplace = false
    @State private var problem: String?
    @State private var seeded = false
    private let hasCamera = AVCaptureDevice.default(for: .video) != nil

    private struct PlayerEntry: Identifiable {
        let id = UUID()
        var name: String
    }

    init(mode: GameMode) {
        self.mode = mode
        let range = mode.playerRange
        let roster = SetupView.loadRoster()
        // The remembered roster, within the mode's player range; without one, two default players.
        let count = roster.map { max(range.lowerBound, min($0.count, range.upperBound)) } ?? max(range.lowerBound, min(2, range.upperBound))
        _players = State(initialValue: (1...count).map { number in
            PlayerEntry(name: roster.flatMap { $0.indices.contains(number - 1) ? $0[number - 1] : nil } ?? "Player \(number)")
        })
        _options = State(initialValue: SetupView.defaults(mode))
        #if os(macOS)
        _cardSource = State(initialValue: .draw)
        #else
        _cardSource = State(initialValue: AVCaptureDevice.default(for: .video) != nil && SetupView.scanModes(mode) ? .scan : .draw)
        #endif
    }

    /// Modes that accept single scanned cards; Daily, Higher or Lower, Lineup and Imposter draw from the deck.
    static func scanModes(_ mode: GameMode) -> Bool {
        ![.daily, .higherLower, .lineup, .imposter].contains(mode)
    }

    /// The preview length of a preview-only account.
    private var previewMs: Int? {
        if case let .previewOnly(maxMs) = playback.tier { return maxMs }
        return nil
    }

    /// Ladder steps longer than a preview-only account's preview (game-rules.md 6.4).
    private var droppedSteps: [Int] {
        guard case let .ladder(ladder) = options, let maxMs = previewMs else { return [] }
        return ladder.steps.filter { $0 > maxMs }
    }

    private static func seconds(_ ms: Int) -> String {
        ms % 1000 == 0 ? "\(ms / 1000) s" : String(format: "%g s", Double(ms) / 1000)
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

    /// The contract defaults, pulled down to what the deck holds (Lineup to three songs when it can't hold four).
    static func startingOptions(_ mode: GameMode, players: Int, deck: Deck?) -> GameOptions {
        var options = defaults(mode)
        guard let pool = deck?.cards else { return options }
        if case var .lineup(lineup) = options, pool.count < lineup.k, pool.count >= 3 {
            lineup.k = pool.count
            options = .lineup(lineup)
        }
        return deckCapacity(options, players: players, pool: pool)?.clamped(options) ?? options
    }

    /// What the deck holds for the chosen length, when that is less than chosen.
    private var capacityNote: String? {
        guard let deck = deckStore.deck else { return nil }
        let pool = easyOnly && mode != .daily ? deck.cards.filter { ($0.difficulty ?? 0) >= 1 && ($0.difficulty ?? 0) <= 2 } : deck.cards
        return deckCapacity(options, players: players.count, pool: pool)?.note(for: options, deckCards: pool.count)
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
                ModeOptionsEditor(options: $options, defaultYear: medianYear, exactClips: playback.tier.exactClips)
                if let note = capacityNote {
                    Text(note).font(.callout).foregroundStyle(.secondary)
                }
                if let maxMs = previewMs, !droppedSteps.isEmpty {
                    let steps = namesList(droppedSteps.map(SetupView.seconds))
                    Text("Previews play up to \(SetupView.seconds(maxMs)), so the \(steps) step\(droppedSteps.count == 1 ? " is" : "s are") left out.")
                        .font(.callout).foregroundStyle(.secondary)
                }
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
                    if hasCamera && SetupView.scanModes(mode) { Text(CardSource.scan.label).tag(CardSource.scan) }
                    Text(CardSource.draw.label).tag(CardSource.draw)
                }
                if !hasCamera { Text("No camera found, so cards are drawn from the deck.").font(.caption).foregroundStyle(.secondary) }
                // Printing is planned, not built: until then testers make their own scannable code.
                if hasCamera, SetupView.scanModes(mode), cardSource == .scan {
                    Text("No printed cards yet? In the Deck tab, choose a card's Direct link QR route, then show that code on another screen or print it, and scan it here.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                if game.resumable { Text("Starting replaces the unfinished saved game.").font(.callout).foregroundStyle(.secondary) }
                if let error = game.lastError { Text(error).foregroundStyle(.red) }
                if let problem { Text(problem).foregroundStyle(.red) }
                Button("Start") {
                    if game.resumable { confirmReplace = true } else { start() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(deckStore.deck == nil)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(ModeAvailability(mode: mode, deck: deckStore.deck, tier: playback.tier).title)
        .onAppear {
            game.lastError = nil
            problem = nil
            // Once, with the deck known: start at what the deck holds when the contract default is more.
            if !seeded {
                seeded = true
                options = SetupView.startingOptions(mode, players: players.count, deck: deckStore.deck)
            }
        }
        .confirmationDialog("Replace the unfinished game?", isPresented: $confirmReplace, titleVisibility: .visible) {
            Button("Replace", role: .destructive) { start() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Starting a new game replaces the unfinished saved game.")
        }
    }

    private func start() {
        guard let deck = deckStore.deck else { return }
        problem = nil
        let sessionPlayers = players.enumerated().map { index, entry in
            SessionPlayer(id: "p\(index + 1)", name: SetupView.cleanName(entry.name, fallback: "Player \(index + 1)"))
        }
        let keys = sessionPlayers.map { $0.name.lowercased() }
        guard Set(keys).count == keys.count else {
            problem = "Names must differ."
            return
        }
        var chosen = options
        // Timeline's tokens and Name It only matter with Challenges (Name It earns a token): hidden, they stay at the defaults.
        if case var .timeline(timeline) = chosen, !timeline.challenges {
            timeline.tokens = TimelineOptions().tokens
            timeline.nameIt = false
            chosen = .timeline(timeline)
        }
        if case let .ladder(ladder) = chosen, ladder.steps.isEmpty {
            problem = "Choose at least one step."
            return
        }
        // A preview-only account drops the steps longer than its preview (game-rules.md 6.4).
        if case var .ladder(ladder) = chosen, let maxMs = previewMs {
            let kept = ladder.steps.filter { $0 <= maxMs }
            guard !kept.isEmpty else {
                problem = "Previews play up to \(SetupView.seconds(maxMs)). Choose a shorter step."
                return
            }
            ladder.steps = kept
            chosen = .ladder(ladder)
        }
        SetupView.saveRoster(sessionPlayers.map(\.name))
        game.start(options: chosen, players: sessionPlayers, deck: deck, cardSource: hasCamera && SetupView.scanModes(mode) ? cardSource : .draw, easyOnly: easyOnly && mode != .daily, kids: kids)
    }

    /// The loaded deck's median curated year, the default for a custom anchor year.
    private var medianYear: Int {
        let years = (deckStore.deck?.cards.map(\.gameYear.value) ?? []).sorted()
        return years.isEmpty ? 1980 : years[years.count / 2]
    }

    /// The remembered player names (`eratic.roster.v1`): 1–10 trimmed names of 1–40 characters, otherwise ignored.
    static let rosterKey = "eratic.roster.v1"

    static func loadRoster(_ defaults: UserDefaults = .standard) -> [String]? {
        guard let names = defaults.stringArray(forKey: rosterKey), (1...10).contains(names.count),
              names.allSatisfy({ $0 == $0.trimmingCharacters(in: .whitespacesAndNewlines) && (1...40).contains($0.unicodeScalars.count) }) else { return nil }
        return names
    }

    /// Remembers the names of a game that starts (Daily doesn't come through setup).
    static func saveRoster(_ names: [String], _ defaults: UserDefaults = .standard) {
        let clean = names.map { cleanName($0, fallback: "") }
        guard (1...10).contains(clean.count), clean.allSatisfy({ !$0.isEmpty }) else { return }
        defaults.set(clean, forKey: rosterKey)
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
    /// The connected tier plays exact clips; Snippet Ladder's *Clip start* only matters then.
    var exactClips = true

    /// The clip lengths a Snippet Ladder step can have (the web setup offers the same five).
    private static let ladderStepChoices = [1000, 5000, 10000, 20000, 30000]

    var body: some View {
        switch options {
        case let .bullseye(value):
            let o = bind(value) { .bullseye($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...100)
            Toggle("Stakes: wager chips on each guess", isOn: o.stakes)
            stakesHint(value.stakes)
        case let .eraSort(value):
            let o = bind(value) { .eraSort($0) }
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...100)
            Toggle("Kids: a neighbouring era scores in full, with larger buttons", isOn: o.kids)
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
            if value.challenges {
                Stepper("Tokens per player: \(value.tokens)", value: o.tokens, in: 0...5)
                Toggle("Name It: name the song to earn a token", isOn: o.nameIt)
            }
            Toggle("Stakes: wager chips on each placement", isOn: o.stakes)
            stakesHint(value.stakes)
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
            if exactClips {
                Picker("Clip start for cards without their own", selection: o.clipStart) {
                    Text("The card's start").tag(LadderClipStart.card)
                    Text("Skip the intro").tag(LadderClipStart.skipIntro)
                    Text("From the beginning").tag(LadderClipStart.zero)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Clip steps")
                HStack {
                    ForEach(Self.ladderStepChoices, id: \.self) { step in
                        Toggle("\(step / 1000) s", isOn: Binding(
                            get: { value.steps.contains(step) },
                            set: { on in
                                var ladder = value
                                // Kept strictly increasing by sorting; the toggles can't repeat a step.
                                ladder.steps = (on ? value.steps + [step] : value.steps.filter { $0 != step }).sorted()
                                options = .ladder(ladder)
                            }
                        ))
                        .toggleStyle(.button)
                    }
                }
            }
            Toggle("Stakes: wager chips on each song", isOn: o.stakes)
            stakesHint(value.stakes)
            Toggle("Buzzer: +2 for the first lock-in that scores", isOn: o.buzzer)
        case let .higherLower(value):
            let o = bind(value) { .higherLower($0) }
            Stepper("Versus ends after \(value.cards) cards", value: o.cards, in: 2...100)
            Text(value.play == .everyone ? "Solo play goes on until your last life is gone." : "Solo play goes on until the first miss.").font(.caption).foregroundStyle(.secondary)
            Picker("Who calls each card", selection: Binding(get: { value.play }, set: { play in
                var next = value
                next.play = play
                // Lives only exist with Everyone; Take turns leaves them unset.
                if play == .turns { next.lives = nil }
                options = .higherLower(next)
            })) {
                Text("Take turns").tag(HigherLowerPlay.turns)
                Text("Everyone, with lives").tag(HigherLowerPlay.everyone)
            }
            if value.play == .everyone {
                Stepper("Lives: \(value.startingLives)", value: Binding(get: { value.startingLives }, set: { lives in
                    var next = value
                    next.lives = lives
                    options = .higherLower(next)
                }), in: 1...5)
            }
            Toggle("Closer years as the game goes on", isOn: o.closer)
        case let .relay(value):
            let o = bind(value) { .relay($0) }
            Stepper("Line of \(value.target) cards wins", value: o.target, in: 2...30)
            Stepper("Lives: \(value.lives)", value: o.lives, in: 1...10)
            AnchorPicker(choice: anchorBinding(get: { ($0.anchor, $0.anchorYear) }, set: { $0.anchor = $1.kind; $0.anchorYear = $1.year }, wrap: GameOptions.relay) {
                if case let .relay(current) = $0 { return current }
                return nil
            }, defaultYear: defaultYear)
            Toggle("Name It: title and artist right gives back a life (up to the start)", isOn: o.nameIt)
        case let .lineup(value):
            let o = bind(value) { .lineup($0) }
            Stepper("Songs per lineup: \(value.k)", value: o.k, in: 3...5)
            Stepper("Rounds: \(value.rounds)", value: o.rounds, in: 1...20)
            Stepper("Clip length: \(value.clipMs / 1000) s", value: o.clipMs, in: 1000...60_000, step: 1000)
        case .daily:
            Text("Up to five songs: three eras, then years. Everyone gets the same songs today.").foregroundStyle(.secondary)
        case let .imposter(value):
            let o = bind(value) { .imposter($0) }
            Stepper("Rounds (one pair each): \(value.rounds)", value: o.rounds, in: 1...50)
        }
    }

    /// What Stakes does to the score, under the switch when it is on.
    @ViewBuilder private func stakesHint(_ on: Bool) -> some View {
        if on {
            Text("Everyone starts with 5 chips; your score is your points plus the chips you hold.").font(.caption).foregroundStyle(.secondary)
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
