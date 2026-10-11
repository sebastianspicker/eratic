import SwiftUI
import EraticCore

/// Higher or Lower: the reference card on the left, the mystery card on the right, *Earlier* and *Later*.
struct HigherLowerInput: View {
    let session: GameSession
    let state: GameState
    let deck: Deck
    @EnvironmentObject private var game: GameController

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
            if let active {
                Text("\(session.playerName(active))'s streak: \(streaks[active] ?? 0)").font(.callout)
                if let call = state.call {
                    Text("\(session.playerName(active)) called \(call == .earlier ? "Earlier" : "Later").").font(.headline)
                } else {
                    HStack {
                        Button("Earlier") { game.dispatch(.call(playerId: active, call: .earlier)) }
                        Button("Later") { game.dispatch(.call(playerId: active, call: .later)) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
        }
    }
}
