import SwiftUI
import EraticCore

/// Original or Imposter: *Play A* and *Play B*, then each player picks A or B and may add a year, hidden until the reveal.
struct ImposterInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    let pair: PairInPlay
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    @EnvironmentObject private var playback: PlaybackHub
    @State private var current: String?
    @State private var pick: PairSide?
    @State private var addYear = false
    @State private var year = 1990
    @State private var playing: PairSide?
    @State private var playError: String?
    @State private var prepareTask: Task<Void, Never>?
    static let clipMs = 30_000

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Two versions of one song. Which is the original?").font(.headline)
            HStack(spacing: 12) {
                playButton(.a, pair.a)
                playButton(.b, pair.b)
            }
            if let playing, prepareTask != nil, !ExactClip.isPlaying(clip) {
                Text("\(playing.rawValue.uppercased()): Preparing…").font(.callout)
            } else if let playing, let status = ExactClip.statusText(clip) {
                Text("\(playing.rawValue.uppercased()): \(status)").font(.callout.monospacedDigit())
            }
            if let playError { Text(playError).foregroundStyle(.red).font(.callout) }
            LockedEntryList(players: session.players, isLocked: { state.choices[$0] != nil }, current: $current) { player in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        sideButton(.a)
                        sideButton(.b)
                    }
                    Toggle("Add a year guess", isOn: $addYear)
                    if addYear { YearField(label: "\(player.name)'s year for the original", year: $year) }
                    Button("Lock in") {
                        guard let pick, game.dispatch(.choose(playerId: player.id, pick: pick, year: addYear ? year : nil)) else { return }
                        current = nil
                        resetEntry()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(pick == nil)
                }
            }
        }
        .onChange(of: current) { resetEntry() }
        .onChange(of: clip.state) { if clip.state == .idle, prepareTask == nil { playing = nil } }
        .onDisappear {
            prepareTask?.cancel()
            prepareTask = nil
        }
    }

    private func playButton(_ side: PairSide, _ card: CardRef) -> some View {
        let label = side.rawValue.uppercased()
        let isPlaying = playing == side && ExactClip.isPlaying(clip)
        return Button(isPlaying ? "Stop \(label)" : "Play \(label)") {
            if isPlaying {
                clip.cancel()
            } else if let song = deck.card(card.cardId), prepareTask == nil {
                playError = nil
                playing = side
                let from = ExactClip.startMs(song, deck: deck)
                prepareTask = Task {
                    let error = await ExactClip.play(song, fromMs: from, lengthMs: Self.clipMs, playback: playback, clip: clip, game: game)
                    guard !Task.isCancelled else { return }
                    playError = error
                    prepareTask = nil
                    if error != nil { playing = nil }
                }
            }
        }
        .disabled(prepareTask != nil)
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }

    private func sideButton(_ side: PairSide) -> some View {
        let selected = pick == side
        let label = side.rawValue.uppercased()
        return Button { pick = side } label: {
            VStack(spacing: 2) {
                Text(label).font(.title.bold())
                Text(selected ? "Selected" : "Original?").font(.caption2.weight(.heavy)).textCase(.uppercase)
            }
            .frame(minWidth: 90, minHeight: 64)
            .foregroundStyle(selected ? Stage.paper : Color.primary)
            .background(selected ? Stage.ink : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(hex: "#8A8072"), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) is the original")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func resetEntry() {
        pick = nil
        addYear = false
        year = 1990
    }
}

/// After a pair: which side was the original, the relation from the deck, both years, then each player's pick.
struct ImposterReveal: View {
    let pair: PairInPlay
    let reveal: RevealSnapshot
    let session: GameSession
    let deck: Deck

    var body: some View {
        let original = pair.original == .a ? pair.a : pair.b
        let other = pair.original == .a ? pair.b : pair.a
        let era = Eras.for(original.year)
        VStack(alignment: .leading, spacing: 10) {
            Text("\(pair.original.rawValue.uppercased()) was the original").font(.title2.bold())
            EraYear(year: original.year, era: era).id(original.cardId)
            songLine(original)
            Divider().overlay(era?.inkColor.opacity(0.4) ?? .secondary)
            Text("\((pair.original == .a ? PairSide.b : .a).rawValue.uppercased()): \(String(other.year))").font(.headline)
            songLine(other)
            if let relation = relationText(original: original, other: other) { Text(relation).font(.callout.weight(.semibold)) }
            Divider().overlay(era?.inkColor.opacity(0.4) ?? .secondary)
            ForEach(resultLines(original), id: \.self) { Text($0).font(.body.weight(.medium)) }
        }
        .foregroundStyle(era?.inkColor ?? .primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(era?.groundColor ?? Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private func songLine(_ card: CardRef) -> some View {
        let song = deck.card(card.cardId)
        return VStack(alignment: .leading, spacing: 2) {
            Text(song?.title ?? card.cardId).font(.title3.bold())
            if let song { Text(song.artist).font(.callout) }
        }
    }

    /// From the deck's `relatedTo`: "“B” is a cover of “A”." or "“A” is the original of “B”."
    private func relationText(original: CardRef, other: CardRef) -> String? {
        let originalSong = deck.card(original.cardId)
        let otherSong = deck.card(other.cardId)
        func title(_ song: SongCard?, _ ref: CardRef) -> String { "“\(song?.title ?? ref.cardId)”" }
        if let related = otherSong?.relatedTo, related.cardId == original.cardId {
            switch related.relation {
            case .coverOf: return "\(title(otherSong, other)) is a cover of \(title(originalSong, original))."
            case .remasterOf: return "\(title(otherSong, other)) is a remaster of \(title(originalSong, original))."
            case .originalOf: break
            }
        }
        if let related = originalSong?.relatedTo, related.cardId == other.cardId, related.relation == .originalOf {
            return "\(title(originalSong, original)) is the original of \(title(otherSong, other))."
        }
        return nil
    }

    private func resultLines(_ original: CardRef) -> [String] {
        let scoresBefore = GameEngine.scores(of: reveal.before)
        let scoresAfter = GameEngine.scores(of: reveal.after)
        return session.players.map { player in
            let delta = signedPoints((scoresAfter[player.id] ?? 0) - (scoresBefore[player.id] ?? 0))
            guard let choice = reveal.before.choices[player.id] else { return "\(player.name) · \(delta)" }
            let yearText = choice.year.map { ", \(String($0)) (\(yearsOffText(Scoring.distance($0, original.year))))" } ?? ""
            return "\(player.name): picked \(choice.pick.rawValue.uppercased())\(yearText) · \(delta)"
        }
    }
}
