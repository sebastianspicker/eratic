import SwiftUI
import EraticCore

/// A timeline as a horizontal strip of era-coloured year chips, with a slot button before, between and after them
/// ("Before 1984", "Between 1984 and 1997", "After 1997"). Arrow keys move between free slots; Return submits.
struct TimelineStrip: View {
    let cards: [CardRef]
    let deck: Deck
    /// Chips only, no slots and no titles: other players' timelines.
    var compact = false
    /// Larger chips and slots (Kids).
    var large = false
    /// The highlighted slot.
    var selected: Int?
    var selectedText = "Your slot"
    /// Slots already taken this turn, with the words shown in them; they can't be chosen.
    var taken: [Int: String] = [:]
    /// A card to mark as new (a reveal's strip).
    var newCardID: String?
    /// Nil: the slots are shown but aren't buttons.
    var onSelect: ((Int) -> Void)?
    var onSubmit: (() -> Void)?

    /// The slot's name in words; the same text is the VoiceOver label.
    static func slotLabel(_ years: [Int], _ slot: Int) -> String {
        guard !years.isEmpty else { return "First card" }
        if slot <= 0 { return "Before \(String(years[0]))" }
        if slot >= years.count { return "After \(String(years[years.count - 1]))" }
        return "Between \(String(years[slot - 1])) and \(String(years[slot]))"
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(alignment: .center, spacing: compact ? 6 : 8) {
                    ForEach(0...cards.count, id: \.self) { slot in
                        if !compact { slotButton(slot).id("slot-\(slot)") }
                        if slot < cards.count { chip(cards[slot]).id("chip-\(slot)") }
                    }
                }
                .padding(.vertical, 4)
            }
            // A long timeline brings the chosen slot into view, centred.
            .onChange(of: selected) {
                guard let selected else { return }
                if reduceMotion {
                    proxy.scrollTo("slot-\(selected)", anchor: .center)
                } else {
                    withAnimation { proxy.scrollTo("slot-\(selected)", anchor: .center) }
                }
            }
        }
        .focusable(onSelect != nil)
        .onKeyPress(.leftArrow) { move(-1) }
        .onKeyPress(.rightArrow) { move(1) }
        .onKeyPress(.return) {
            guard let onSubmit, selected != nil else { return .ignored }
            onSubmit()
            return .handled
        }
    }

    private var years: [Int] { cards.map(\.year) }

    private func move(_ direction: Int) -> KeyPress.Result {
        guard let onSelect else { return .ignored }
        var slot = selected ?? (direction > 0 ? -1 : cards.count + 1)
        repeat { slot += direction } while taken[slot] != nil && (0...cards.count).contains(slot)
        guard (0...cards.count).contains(slot) else { return .handled }
        onSelect(slot)
        return .handled
    }

    private func slotButton(_ slot: Int) -> some View {
        let label = Self.slotLabel(years, slot)
        let isSelected = selected == slot
        let takenText = taken[slot]
        return Button { onSelect?(slot) } label: {
            VStack(spacing: 4) {
                Image(systemName: isSelected ? "arrowtriangle.down.fill" : takenText != nil ? "flag.fill" : "plus")
                    .accessibilityHidden(true)
                Text(label).font((large ? Font.callout : .caption2).weight(.semibold)).multilineTextAlignment(.center)
                if isSelected {
                    Text(selectedText).font(.caption2.weight(.heavy)).textCase(.uppercase)
                } else if let takenText {
                    Text(takenText).font(.caption2)
                }
            }
            .frame(width: large ? 120 : 92)
            .frame(minHeight: large ? 96 : 72)
            .padding(4)
            .foregroundStyle(isSelected ? Stage.paper : Color.primary)
            .background(isSelected ? Stage.ink : Color.secondary.opacity(takenText != nil ? 0.18 : 0.06), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(hex: "#8A8072"), style: StrokeStyle(lineWidth: 1, dash: isSelected ? [] : [4, 3])))
        }
        .buttonStyle(.plain)
        .disabled(onSelect == nil || takenText != nil)
        .accessibilityLabel(label)
        .accessibilityValue(isSelected ? selectedText : takenText ?? "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func chip(_ card: CardRef) -> some View {
        let era = Eras.for(card.year)
        let title = deck.card(card.cardId)?.title ?? card.cardId
        let isNew = newCardID.map { $0.utf8.elementsEqual(card.cardId.utf8) } ?? false
        return VStack(spacing: 4) {
            Text(String(card.year))
                .font(.system(compact ? .caption : large ? .title2 : .headline, design: .rounded).weight(.heavy))
                .monospacedDigit()
                .padding(.horizontal, compact ? 8 : 12)
                .padding(.vertical, compact ? 3 : 6)
                .foregroundStyle(era?.onAccentColor ?? .primary)
                .background(Capsule().fill(era?.accentColor ?? Color.secondary.opacity(0.2)))
            if !compact {
                Text(title).font(.caption2).lineLimit(2).multilineTextAlignment(.center).frame(width: large ? 110 : 84)
            }
        }
        .overlay(isNew ? RoundedRectangle(cornerRadius: 10).strokeBorder(Stage.ink, lineWidth: 2).padding(-4) : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(String(card.year))" + (era.map { ", \($0.label) \($0.name)" } ?? "") + (compact ? "" : ", \(title)"))
        .accessibilityValue(isNew ? "new" : "")
    }
}
