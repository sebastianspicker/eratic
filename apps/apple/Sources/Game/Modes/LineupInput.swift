import SwiftUI
import EraticCore

/// How a Lineup set is played: exact clips, preview snippets (no exact clips, but at least one tile has a Spotify or
/// Apple Music preview), or by name (neither: every tile shows its title and artist).
enum LineupPlayMode: Equatable {
    case exact, snippets, byName

    static func of(cards: [CardRef], deck: Deck, tier: PlaybackTier) -> LineupPlayMode {
        if tier.exactClips { return .exact }
        return cards.contains { deck.card($0.cardId).map(SongBackup.hasSnippet) ?? false } ? .snippets : .byName
    }

    /// The mode's title on Play home and the host bar: "Lineup by name" only when no card in the deck can play a snippet.
    static func byName(deck: Deck?, tier: PlaybackTier) -> Bool {
        !tier.exactClips && !(deck?.cards.contains(where: SongBackup.hasSnippet) ?? false)
    }
}

/// Lineup (and the `lineup` sudden death): tiles A–E, each with its own *Play*, then each player taps the tiles
/// into order (earliest first), adjusting with *Move up* / *Move down* and *Remove*, hidden as "Locked" until the
/// reveal. Without exact clips the tiles play preview snippets; a tile without a preview shows its title and artist
/// instead, and with no preview at all the set is "Lineup by name".
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
    @State private var orderError: String?
    /// Owned here, not by the tiles, so the order list can show the title of a tile whose preview failed.
    @StateObject private var snippets = TileSnippets()

    private var mode: LineupPlayMode { LineupPlayMode.of(cards: cards, deck: deck, tier: playback.tier) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LineupTiles(cards: cards, deck: deck, clipMs: clipMs, mode: mode, snippets: snippets, clip: clip)
            Text("Earliest first").font(.headline)
            LockedEntryList(players: players, isLocked: isLocked, current: $current) { player in
                VStack(alignment: .leading, spacing: 10) {
                    pool
                    ForEach(Array(order.enumerated()), id: \.element) { position, id in
                        row(position, id)
                    }
                    if let orderError { Text(orderError).foregroundStyle(.red).font(.callout) }
                    HStack(spacing: 10) {
                        Button("Lock in order") {
                            guard order.count == cards.count else {
                                orderError = "Place every song first."
                                return
                            }
                            orderError = nil
                            guard submit(player.id, order) else { return }
                            current = nil
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Clear") { resetEntry() }
                            .disabled(order.isEmpty)
                    }
                }
            }
        }
        .onChange(of: current) { resetEntry() }
    }

    private func resetEntry() {
        order = []
        orderError = nil
    }

    /// The tiles not placed yet, as buttons; tapping one appends it to the order.
    private var pool: some View {
        let unplaced = cards.map(\.cardId).filter { !order.contains($0) }
        return VStack(alignment: .leading, spacing: 6) {
            Text(unplaced.isEmpty ? "Every song is placed." : "Tap the songs in order, earliest first.").font(.callout).foregroundStyle(.secondary)
            if !unplaced.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(unplaced, id: \.self) { id in
                        Button(label(id)) {
                            order.append(id)
                            orderError = nil
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .accessibilityLabel("Place \(label(id)) next")
                    }
                }
            }
        }
    }

    private func index(_ id: String) -> Int { cards.firstIndex { $0.cardId == id } ?? 0 }

    private func letter(_ id: String) -> String { tileLetter(index(id)) }

    /// "B", or "B · Title" when the tile shows its title.
    private func label(_ id: String) -> String {
        let name = LineupTiles.showsTitle(mode: mode, song: deck.card(id), failed: snippets.failed.contains(index(id))) ? deck.card(id).map { " · \($0.title)" } ?? "" : ""
        return letter(id) + name
    }

    private func row(_ position: Int, _ id: String) -> some View {
        HStack {
            Text("\(position + 1).").monospacedDigit().foregroundStyle(.secondary)
            Text(label(id)).font(.headline)
            Spacer()
            Button { move(position, by: -1) } label: { Image(systemName: "arrow.up") }
                .accessibilityLabel("Move \(letter(id)) up")
                .disabled(position == 0)
            Button { move(position, by: 1) } label: { Image(systemName: "arrow.down") }
                .accessibilityLabel("Move \(letter(id)) down")
                .disabled(position == order.count - 1)
            Button { order.remove(at: position) } label: { Image(systemName: "xmark") }
                .accessibilityLabel("Remove \(letter(id))")
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

/// The set's tiles, A–E: a *Play* button and playing state each (an exact clip, or a preview snippet), or title and
/// artist for a tile that can't play; below them the backup QR and hidden preview of one selected song.
struct LineupTiles: View {
    let cards: [CardRef]
    let deck: Deck
    let clipMs: Int
    let mode: LineupPlayMode
    @ObservedObject var snippets: TileSnippets
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var playback: PlaybackHub
    @EnvironmentObject private var game: GameController
    @State private var playing: Int?
    @State private var playError: String?
    @State private var prepareTask: Task<Void, Never>?
    /// Starting an exact tile clip remounts the backup's preview, which stops it.
    @State private var previewRevision = UUID()
    /// Snippets are at most 30 s, from the preview's start.
    static let snippetCapMs = 30_000

    /// A tile shows its title and artist when the set is played by name, or (with snippets) when it has no preview
    /// or its preview failed to load.
    static func showsTitle(mode: LineupPlayMode, song: SongCard?, failed: Bool = false) -> Bool {
        switch mode {
        case .exact: return false
        case .byName: return true
        case .snippets: return failed || !(song.map(SongBackup.hasSnippet) ?? false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                    tile(index, card)
                }
            }
            if mode == .snippets, let url = snippets.url {
                SnippetPreview(controller: snippets.controller, url: url).id(url)
            }
            if let problem = snippets.problem { Text(problem).font(.callout) }
            SetBackup(cards: cards, deck: deck, collapsed: mode != .byName, previewID: previewRevision)
            if let playError { Text(playError).foregroundStyle(.red).font(.callout) }
        }
        .onAppear {
            guard mode == .snippets else { return }
            var urls: [Int: URL] = [:]
            for (index, card) in cards.enumerated() {
                if let song = deck.card(card.cardId), let url = SongBackup.snippetURL(for: song, provider: playback.provider) { urls[index] = url }
            }
            snippets.configure(urls: urls, lengthMs: min(clipMs, Self.snippetCapMs))
        }
        .onChange(of: clip.state) { if clip.state == .idle, prepareTask == nil { playing = nil } }
        .onDisappear {
            prepareTask?.cancel()
            prepareTask = nil
            snippets.stop()
        }
    }

    private func tile(_ index: Int, _ card: CardRef) -> some View {
        let letter = tileLetter(index)
        let song = deck.card(card.cardId)
        let isPlaying = (playing == index && ExactClip.isPlaying(clip)) || snippets.isPlaying(index)
        return VStack(alignment: .leading, spacing: 6) {
            Text(letter).font(.system(.largeTitle, design: .rounded).weight(.heavy))
            if Self.showsTitle(mode: mode, song: song, failed: snippets.failed.contains(index)) {
                Text(song?.title ?? card.cardId).font(.headline)
                if let song { Text(song.artist).font(.callout) }
                if snippets.failed.contains(index) { Text("Preview unavailable").font(.caption) }
            } else if mode == .snippets {
                SnippetTileButton(snippets: snippets, index: index)
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
        previewRevision = UUID()
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
    /// The reveal's stage (see `RevealView`): the years, then the songs, then the results.
    var shown = 2
    var leader: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("The right order").font(.title2.bold())
            ForEach(Array(rightOrder.enumerated()), id: \.offset) { position, entry in
                HStack(spacing: 10) {
                    Text("\(position + 1).").monospacedDigit().foregroundStyle(.secondary)
                    YearChip(year: entry.card.year)
                    Group {
                        Text(tileLetter(entry.index)).font(.headline)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(deck.card(entry.card.cardId)?.title ?? entry.card.cardId).font(.headline)
                            if let artist = deck.card(entry.card.cardId)?.artist { Text(artist).font(.caption) }
                        }
                    }
                    .opacity(shown >= 1 ? 1 : 0)
                }
                .accessibilityElement(children: .combine)
            }
            Group {
                Divider()
                ForEach(resultLines, id: \.self) { Text($0).font(.body.weight(.medium)) }
                if let leader { Text(leader).font(.headline) }
            }
            .opacity(shown >= 2 ? 1 : 0)
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
                return "\(session.playerName(player)): \(letters(order)) · \(points) point\(points == 1 ? "" : "s")"
            }
            lines.append(suddenDeathOutcome(after, session))
            return lines
        }
        let scoresBefore = GameEngine.scores(of: before)
        let scoresAfter = GameEngine.scores(of: after)
        return session.players.map { player in
            let delta = signedPoints((scoresAfter[player.id] ?? 0) - (scoresBefore[player.id] ?? 0))
            let perfect = (after.perfectLines(for: player.id) ?? 0) > (before.perfectLines(for: player.id) ?? 0) ? ", perfect line" : ""
            return "\(player.name): \(before.orders[player.id].map(letters) ?? "no order") · \(delta)\(perfect)"
        }
    }
}

/// "Ada wins the sudden death." or "Still tied: …".
func suddenDeathOutcome(_ after: GameState, _ session: GameSession) -> String {
    if let winner = after.suddenDeathInfo?.winner { return "\(session.playerName(winner)) wins the sudden death." }
    if let still = after.suddenDeathInfo?.players { return "Still tied: \(namesList(still.map(session.playerName))). Another round decides." }
    return ""
}
