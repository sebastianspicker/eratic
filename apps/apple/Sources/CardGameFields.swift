import SwiftUI
import EraticCore

/// Deck format 2 "Game" fields for one card: clip start, difficulty and a related recording.
/// Edits are drafts until *Save game fields*; validation happens in `EraticCore`.
struct CardGameFields: View {
    let card: SongCard
    let otherCards: [SongCard]
    let onSave: (CardClip?, Int?, RelatedCard?) throws -> Void
    @State private var clipText: String
    @State private var difficulty: Int
    @State private var relatedID: String
    @State private var relation: Relation
    @State private var errorMessage: String?

    init(card: SongCard, otherCards: [SongCard], onSave: @escaping (CardClip?, Int?, RelatedCard?) throws -> Void) {
        self.card = card
        self.otherCards = otherCards
        self.onSave = onSave
        _clipText = State(initialValue: card.clip.map { ClipSeconds.text($0.startMs) } ?? "")
        _difficulty = State(initialValue: card.difficulty ?? 0)
        _relatedID = State(initialValue: card.relatedTo?.cardId ?? "")
        _relation = State(initialValue: card.relatedTo?.relation ?? .coverOf)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Game").font(.title2.bold())
            Text("Optional. Used by Snippet Ladder, Lineup, Original or Imposter and “Easy cards only”.").font(.caption).foregroundStyle(.secondary)
            LabeledContent("Clip start (seconds)") {
                TextField("Deck default", text: $clipText)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 140)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
            }
            Picker("Difficulty", selection: $difficulty) {
                Text("None").tag(0)
                ForEach(1...5, id: \.self) { Text(String($0)).tag($0) }
            }
            Picker("Related recording", selection: $relatedID) {
                Text("None").tag("")
                ForEach(otherCards) { other in Text("\(other.title) · \(other.artist)").tag(other.id) }
            }
            if !relatedID.isEmpty {
                Picker("This card is the", selection: $relation) {
                    ForEach(Relation.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                if let other = otherCards.first(where: { $0.id == relatedID }) {
                    Text("“\(card.title)” is the \(relation.label) “\(other.title)”.").font(.callout)
                }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(.callout) }
            Button("Save game fields") { save() }
                .buttonStyle(.bordered)
        }
    }

    private func save() {
        errorMessage = nil
        var clip: CardClip?
        if !clipText.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let ms = ClipSeconds.parse(clipText) else {
                errorMessage = "Enter the clip start in seconds, such as 15 or 15.5."
                return
            }
            clip = CardClip(startMs: ms)
        }
        let related = relatedID.isEmpty ? nil : RelatedCard(cardId: relatedID, relation: relation)
        do {
            try onSave(clip, difficulty == 0 ? nil : difficulty, related)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// The deck's default clip start (deck format 2), in seconds.
struct DefaultClipStartEditor: View {
    let deck: Deck
    let onSave: (Int?) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var errorMessage: String?

    init(deck: Deck, onSave: @escaping (Int?) throws -> Void) {
        self.deck = deck
        self.onSave = onSave
        _text = State(initialValue: deck.defaultClipStartMs.map { ClipSeconds.text($0) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Default clip start in seconds (empty: none)", text: $text)
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                } footer: {
                    Text("Cards without their own clip start begin here in Snippet Ladder and Lineup.")
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            .navigationTitle("Default clip start")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        #if os(macOS)
        .frame(width: 420, height: 240)
        #endif
    }

    private func save() {
        var ms: Int?
        if !text.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let parsed = ClipSeconds.parse(text) else {
                errorMessage = "Enter the clip start in seconds, such as 15 or 15.5."
                return
            }
            ms = parsed
        }
        do {
            try onSave(ms)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Seconds as typed by the host ↔ milliseconds as stored.
enum ClipSeconds {
    static func parse(_ text: String) -> Int? {
        guard let seconds = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")), seconds.isFinite, seconds >= 0 else { return nil }
        return Int((seconds * 1000).rounded())
    }

    /// Up to three decimals with trailing zeros trimmed, so a stored value round-trips exactly through `parse`.
    static func text(_ ms: Int) -> String {
        guard ms % 1000 != 0 else { return String(ms / 1000) }
        var fraction = String(format: "%03d", abs(ms % 1000))
        while fraction.hasSuffix("0") { fraction.removeLast() }
        return (ms < 0 ? "-" : "") + "\(abs(ms) / 1000).\(fraction)"
    }
}

extension Relation {
    var label: String {
        switch self {
        case .originalOf: return "original of"
        case .coverOf: return "cover of"
        case .remasterOf: return "remaster of"
        }
    }
}
