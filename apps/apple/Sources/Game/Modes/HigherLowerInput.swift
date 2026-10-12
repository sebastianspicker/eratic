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
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Last song").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        YearChip(year: reference.year)
                        Text(deck.card(reference.cardId)?.title ?? reference.cardId).font(.headline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
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
