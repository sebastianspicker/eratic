import SwiftUI
import EraticCore

struct CardDetail: View {
    let card: SongCard
    let deckId: String
    let otherCards: [SongCard]
    let onSaveYear: (GameYear) throws -> Void
    let onSaveGameFields: (CardClip?, Int?, RelatedCard?) throws -> Void
    @State private var mode: QRMode = .official
    @State private var linkIndex = 0
    @State private var editingCard: SongCard?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                EraHero(card: card)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Curated game year").font(.headline)
                    Text(card.gameYear.source).font(.callout).textSelection(.enabled)
                    if let note = card.gameYear.note { Text(note).font(.caption).foregroundStyle(.secondary) }
                    Button("Edit year & evidence") { editingCard = card }
                }
                Divider()
                CardGameFields(card: card, otherCards: otherCards, onSave: onSaveGameFields)
                    .id("\(card.clip?.startMs ?? -1)-\(card.difficulty ?? 0)-\(card.relatedTo?.cardId ?? "")-\(card.relatedTo?.relation.rawValue ?? "")")
                Divider()
                VStack(alignment: .leading, spacing: 16) {
                    Text("QR preview").font(.title2.bold())
                    Picker("Card route", selection: $mode) {
                        ForEach(availableModes) { item in Text(item.label).tag(item) }
                    }
                    .pickerStyle(.segmented)
                    if mode == .directLink, !card.links.isEmpty {
                        Picker("Provider link", selection: $linkIndex) {
                            ForEach(Array(card.links.enumerated()), id: \.offset) { index, link in
                                Text("\(link.provider.label) · \(index + 1)").tag(index)
                            }
                        }
                    }
                    if let payload = QRRoute.payload(for: card, mode: mode, linkIndex: linkIndex, eratic: eraticRoute) {
                        QRPreview(payload: payload)
                            .frame(maxWidth: .infinity)
                        Text(routeCaption)
                            .font(.callout.weight(.medium))
                        Text(payload).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        if mode == .official, let notes = card.officialCard?.notes { Text(notes).font(.caption) }
                    } else {
                        ContentUnavailableView(
                            mode == .official ? "No official mapping supplied" : "No provider links supplied",
                            systemImage: "qrcode",
                            description: Text(mode == .official ? "This card has no supplied official-card URL. A direct-link QR is available only in Direct link mode." : "Add a provider URL to this card in the deck JSON.")
                        )
                    }
                }
                Text("Card ID · \(card.id)").font(.caption.monospaced()).foregroundStyle(.secondary)
                Text("Edits stay in this window until you export JSON.").font(.caption).foregroundStyle(.secondary)
            }
            .padding(28)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Card details")
        .sheet(item: $editingCard) { draft in
            YearEditor(card: draft, onSave: onSaveYear)
        }
    }

    /// The Eratic card route appears only once a build configures a host (see docs/STATUS.md).
    private var availableModes: [QRMode] {
        QRMode.allCases.filter { $0 != .eraticCard || !AppConfig.eraticCardHosts.isEmpty }
    }

    private var eraticRoute: EraticCardRoute? {
        AppConfig.eraticCardHosts.first.map { EraticCardRoute(host: $0, deckId: deckId) }
    }

    private var routeCaption: String {
        switch mode {
        case .official: return "Supplied mapping — unverified"
        case .directLink: return "Direct provider link · opens outside the official Hitster app"
        case .eraticCard: return "Eratic card · selects this card in a loaded deck"
        }
    }
}

private struct YearEditor: View {
    let card: SongCard
    let onSave: (GameYear) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var year: String
    @State private var source: String
    @State private var note: String
    @State private var errorMessage: String?

    init(card: SongCard, onSave: @escaping (GameYear) throws -> Void) {
        self.card = card
        self.onSave = onSave
        _year = State(initialValue: String(card.gameYear.value))
        _source = State(initialValue: card.gameYear.source)
        _note = State(initialValue: card.gameYear.note ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Game answer") {
                    TextField("Year (1850–2100)", text: $year)
                    TextField("Source or evidence", text: $source, axis: .vertical)
                    TextField("Optional note", text: $note, axis: .vertical)
                }
                Section {
                    Text("Use the recording’s original release year. Provider dates remain separate.")
                        .foregroundStyle(.secondary)
                    if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Year & evidence")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        #if os(macOS)
        .frame(width: 480, height: 400)
        #endif
    }

    private func save() {
        guard let value = Int(year) else {
            errorMessage = "Enter a whole-number year."
            return
        }
        let isBlankNote = note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let gameYear = GameYear(value: value, source: source, note: isBlankNote ? nil : note)
        do {
            try onSave(gameYear)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
