import SwiftUI
import EraticCore

/// A year 1850–2100 with −/+ steppers and a text field.
struct YearField: View {
    let label: String
    @Binding var year: Int
    var large = false
    static let range = 1850...2100

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
            Spacer(minLength: 8)
            Button { year = max(Self.range.lowerBound, year - 1) } label: { Image(systemName: "minus") }
                .accessibilityLabel("One year earlier")
            TextField(label, value: Binding(get: { year }, set: { year = min(max($0, Self.range.lowerBound), Self.range.upperBound) }),
                      format: .number.grouping(.never))
                .multilineTextAlignment(.center)
                .monospacedDigit()
                .font(large ? .title.weight(.semibold) : .title3.weight(.semibold))
                .frame(width: large ? 110 : 80)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .accessibilityValue(String(year))
            Button { year = min(Self.range.upperBound, year + 1) } label: { Image(systemName: "plus") }
                .accessibilityLabel("One year later")
        }
        .buttonStyle(.bordered)
        .controlSize(large ? .extraLarge : .large)
        .accessibilityElement(children: .contain)
    }
}

/// One player at a time enters a hidden value; entered players show only "Locked" until the reveal,
/// so the host device can be passed around.
struct LockedEntryList<Entry: View>: View {
    let players: [SessionPlayer]
    let isLocked: (String) -> Bool
    @Binding var current: String?
    @ViewBuilder let entry: (SessionPlayer) -> Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(players, id: \.id) { player in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(player.name).font(.headline)
                        Spacer()
                        if isLocked(player.id) {
                            Label("Locked", systemImage: "lock.fill").foregroundStyle(.secondary)
                        } else if current != player.id {
                            Button("Enter for \(player.name)") { current = player.id }
                        }
                    }
                    if current == player.id, !isLocked(player.id) {
                        entry(player)
                    }
                }
                .padding(12)
                .background(Color.secondary.opacity(current == player.id ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

/// Stakes: a 1–3 chip wager, disabled with the reason at 0 chips.
struct WagerControl: View {
    let held: Int
    @Binding var wager: Int

    var body: some View {
        if held < 1 {
            Text("No chips left, so no wager on this card.").font(.callout).foregroundStyle(.secondary)
        } else {
            let top = min(3, held)
            Stepper("Wager: \(min(wager, top)) of \(held) chips", value: Binding(get: { min(wager, top) }, set: { wager = $0 }), in: 1...top)
        }
    }
}

/// The nine eras as a 3×3 grid of tiles in their own colours.
struct EraGrid: View {
    @Binding var selection: String?
    var large = false

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(EraBoundaries.all) { boundary in
                tile(boundary, Eras.all.first { $0.id == boundary.id })
            }
        }
    }

    private func tile(_ boundary: EraBoundary, _ era: Era?) -> some View {
        let selected = selection == boundary.id
        let label = era?.label ?? ""
        return Button { selection = boundary.id } label: {
            VStack(spacing: 4) {
                Text(boundary.name)
                    .font(era?.font(size: large ? 24 : 19) ?? .headline)
                    .textCase(era?.textCase)
                Text(label).font(.caption.weight(.semibold))
                if selected { Text("Selected").font(.caption2.weight(.heavy)).textCase(.uppercase) }
            }
            .frame(maxWidth: .infinity, minHeight: large ? 110 : 84)
            .padding(6)
            .foregroundStyle(era?.inkColor ?? .primary)
            .background(era?.groundColor ?? Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? (era?.accentColor ?? .accentColor) : .clear, lineWidth: 4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(boundary.name), \(label)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The card's song, looked up in the deck.
extension Deck {
    func card(_ id: String) -> SongCard? { cards.first { $0.id == id } }
}
