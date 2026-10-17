import SwiftUI
import EraticCore

/// Higher or Lower: the reference card on the left, the mystery card on the right, *Earlier* and *Later*.
struct HigherLowerInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @ObservedObject var clip: ClipController
    @EnvironmentObject private var game: GameController
    /// Everyone play: the player whose entry is open on the passed device.
    @State private var current: String?

    var body: some View {
        let active = state.activePlayerID
        let streaks = GameEngine.summary(of: state)["streaks"] as? [String: Int] ?? [:]
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 16) {
                if let reference = state.referenceCard {
                    referenceBlock(reference)
                }
                Image(systemName: "arrow.right").accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text("This song").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text("?").font(.title.bold()).frame(width: 64, height: 32).background(Capsule().fill(Stage.ink)).foregroundStyle(Stage.paper)
                        .accessibilityLabel("Mystery year")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if state.isEveryonePlay {
                everyoneEntries
            } else if let active {
                Text("\(session.playerName(active))'s streak: \(streaks[active] ?? 0)").font(.callout)
                if let call = state.call {
                    Text("\(session.playerName(active)) called \(call == .earlier ? "Earlier" : "Later").").font(.headline)
                } else {
                    HStack {
                        Button("Earlier") { decide(active, .earlier) }
                        Button("Later") { decide(active, .later) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
        }
    }

    /// The one number the room decides on: the reference year large, in its era's colours, with title and artist.
    private func referenceBlock(_ reference: CardRef) -> some View {
        let era = Eras.for(reference.year)
        let song = deck.card(reference.cardId)
        return VStack(alignment: .leading, spacing: 4) {
            Text("Last song").font(.callout.weight(.semibold))
            Text(String(reference.year))
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(song?.title ?? reference.cardId).font(.headline)
            if let artist = song?.artist { Text(artist).font(.callout) }
        }
        .foregroundStyle(era?.inkColor ?? .primary)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(era?.groundColor ?? Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    /// Everyone play: each player still in calls Earlier or Later in turn; the calls stay hidden ("Locked") until the reveal.
    private var everyoneEntries: some View {
        let players = session.players.filter { !state.eliminated.contains($0.id) }
        return VStack(alignment: .leading, spacing: 10) {
            LockedEntryList(players: players, isLocked: { state.calls[$0] != nil }, current: $current) { player in
                HStack {
                    Button("Earlier") { lock(player.id, .earlier) }
                    Button("Later") { lock(player.id, .later) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            ForEach(session.players.filter { state.eliminated.contains($0.id) }, id: \.id) { player in
                HStack {
                    Text(player.name).font(.headline)
                    Spacer()
                    Text("Out").foregroundStyle(.secondary)
                }
                .padding(12)
                .background(Color.secondary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func lock(_ player: String, _ call: HigherLowerCall) {
        clip.cancel()
        if game.dispatch(.call(playerId: player, call: call)) { current = nil }
    }

    /// One decision: the call and the reveal together. A call that is rejected reveals nothing.
    private func decide(_ player: String, _ call: HigherLowerCall) {
        clip.cancel()
        guard game.dispatch(.call(playerId: player, call: call)) else { return }
        game.dispatch(.reveal)
    }
}
