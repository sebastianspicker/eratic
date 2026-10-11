import SwiftUI
import EraticCore

/// Lineup (and the `lineup` sudden death): tiles A–E, each with its own *Play*, then each player orders them
/// with *Move up* / *Move down*, hidden as "Locked" until the reveal. Without exact clips the tiles show
/// title and artist instead ("Lineup by name").
struct LineupInput: View {
    let cards: [CardRef]
    let deck: Deck
    let players: [SessionPlayer]
    let clipMs: Int
    let isLocked: (String) -> Bool
    /// Dispatches the player's order; true when accepted.
    let submit: (String, [String]) -> Bool
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var playback: PlaybackHub
    @State private var current: String?
    @State private var order: [String] = []

    private var byName: Bool { !playback.tier.exactClips }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LineupTiles(cards: cards, deck: deck, clipMs: clipMs, byName: byName, clip: clip)
            Text("Earliest first").font(.headline)
            LockedEntryList(players: players, isLocked: isLocked, current: $current) { player in
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(order.enumerated()), id: \.element) { position, id in
                        row(position, id)
                    }
                    Button("Lock in order") {
                        guard submit(player.id, order) else { return }
                        current = nil
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .onAppear { order = cards.map(\.cardId) }
        .onChange(of: current) { order = cards.map(\.cardId) }
    }

    private func letter(_ id: String) -> String {
        tileLetter(cards.firstIndex { $0.cardId == id } ?? 0)
    }

    private func row(_ position: Int, _ id: String) -> some View {
        let name = byName ? deck.card(id).map { " · \($0.title)" } ?? "" : ""
        return HStack {
            Text("\(position + 1).").monospacedDigit().foregroundStyle(.secondary)
            Text(letter(id) + name).font(.headline)
            Spacer()
            Button { move(position, by: -1) } label: { Image(systemName: "arrow.up") }
                .accessibilityLabel("Move \(letter(id)) up")
                .disabled(position == 0)
            Button { move(position, by: 1) } label: { Image(systemName: "arrow.down") }
                .accessibilityLabel("Move \(letter(id)) down")
                .disabled(position == order.count - 1)
        }
        .buttonStyle(.bordered)
        .accessibilityElement(children: .contain)
    }

    private func move(_ position: Int, by offset: Int) {
        let target = position + offset
        guard order.indices.contains(position), order.indices.contains(target) else { return }
        order.swapAt(position, target)
    }
}

/// The set's tiles, A–E: a *Play* button and playing state each, or title and artist when playing by name.
struct LineupTiles: View {
    let cards: [CardRef]
    let deck: Deck
    let clipMs: Int
    let byName: Bool
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var playback: PlaybackHub
    @EnvironmentObject private var game: GameController
    @State private var playing: Int?
    @State private var playError: String?
    @State private var prepareTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                    tile(index, card)
                }
            }
            if let playError { Text(playError).foregroundStyle(.red).font(.callout) }
        }
        .onChange(of: clip.state) { if clip.state == .idle, prepareTask == nil { playing = nil } }
        .onDisappear {
            prepareTask?.cancel()
            prepareTask = nil
        }
    }

    private func tile(_ index: Int, _ card: CardRef) -> some View {
        let letter = tileLetter(index)
        let song = deck.card(card.cardId)
        let isPlaying = playing == index && ExactClip.isPlaying(clip)
        return VStack(alignment: .leading, spacing: 6) {
            Text(letter).font(.system(.largeTitle, design: .rounded).weight(.heavy))
            if byName {
                Text(song?.title ?? card.cardId).font(.headline)
                if let song { Text(song.artist).font(.callout) }
            } else {
                Button(isPlaying ? "Stop \(letter)" : "Play \(letter)") {
                    if isPlaying { clip.cancel() } else { play(index, song) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(prepareTask != nil)
                if playing == index, prepareTask != nil, !isPlaying {
                    Text("Preparing…").font(.caption)
                } else if playing == index, let status = ExactClip.statusText(clip) {
                    Text(status).font(.caption.monospacedDigit())
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
        .padding(12)
        .foregroundStyle(isPlaying ? Stage.paper : Color.primary)
        .background(isPlaying ? Stage.ink : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Song \(letter)" + (isPlaying ? ", playing" : ""))
    }

    private func play(_ index: Int, _ song: SongCard?) {
        guard let song, prepareTask == nil else { return }
        playError = nil
        playing = index
        let from = ExactClip.startMs(song, deck: deck)
        prepareTask = Task {
            let error = await ExactClip.play(song, fromMs: from, lengthMs: clipMs, playback: playback, clip: clip, game: game)
            guard !Task.isCancelled else { return }
            playError = error
            prepareTask = nil
            if error != nil { playing = nil }
        }
    }
}

/// After a Lineup (or `lineup` sudden death): the right order as era chips, then each player's order and result.
struct LineupReveal: View {
    let cards: [CardRef]
    let reveal: RevealSnapshot
    let session: GameSession
    let deck: Deck

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("The right order").font(.title2.bold())
            ForEach(Array(rightOrder.enumerated()), id: \.offset) { position, entry in
                HStack(spacing: 10) {
                    Text("\(position + 1).").monospacedDigit().foregroundStyle(.secondary)
                    YearChip(year: entry.card.year)
                    Text(tileLetter(entry.index)).font(.headline)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(deck.card(entry.card.cardId)?.title ?? entry.card.cardId).font(.headline)
                        if let artist = deck.card(entry.card.cardId)?.artist { Text(artist).font(.caption) }
                    }
                }
                .accessibilityElement(children: .combine)
            }
            Divider()
            ForEach(resultLines, id: \.self) { Text($0).font(.body.weight(.medium)) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    /// By year; equal years keep their tile order.
    private var rightOrder: [(index: Int, card: CardRef)] {
        cards.enumerated().map { (index: $0.offset, card: $0.element) }.sorted { $0.card.year != $1.card.year ? $0.card.year < $1.card.year : $0.index < $1.index }
    }

    private func letters(_ order: [String]) -> String {
        order.map { id in tileLetter(cards.firstIndex { $0.cardId == id } ?? 0) }.joined(separator: " ")
    }

    private var resultLines: [String] {
        let before = reveal.before
        let after = reveal.after
        let years = Dictionary(cards.map { ($0.cardId, $0.year) }, uniquingKeysWith: { first, _ in first })
        if before.phase == .suddenDeathOpen, let info = before.suddenDeathInfo {
            var lines = info.players.map { player -> String in
                guard let order = info.orders[player] else { return session.playerName(player) }
                let points = (try? Scoring.lineupPoints(order: order, years: years)) ?? 0
                return "\(session.playerName(player)): \(letters(order)) · \(points) points"
            }
            lines.append(suddenDeathOutcome(after, session))
            return lines
        }
        let scoresBefore = GameEngine.scores(of: before)
        let scoresAfter = GameEngine.scores(of: after)
        return session.players.map { player in
            let delta = signedPoints((scoresAfter[player.id] ?? 0) - (scoresBefore[player.id] ?? 0))
            return "\(player.name): \(before.orders[player.id].map(letters) ?? "no order") · \(delta)"
        }
    }
}

/// "Ada wins the sudden death." or "Still tied: …".
func suddenDeathOutcome(_ after: GameState, _ session: GameSession) -> String {
    if let winner = after.suddenDeathInfo?.winner { return "\(session.playerName(winner)) wins the sudden death." }
    if let still = after.suddenDeathInfo?.players { return "Still tied: \(namesList(still.map(session.playerName))). Another round decides." }
    return ""
}
