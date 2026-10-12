import SwiftUI
import EraticCore

struct DeckWorkspace: View {
    @EnvironmentObject private var store: DeckStore
    @State private var selectedCardID: String?
    @State private var showImporter = false
    @State private var showExporter = false
    @State private var exportDocument: DeckDocument?
    @State private var errorMessage: String?
    @State private var showDefaultClipStart = false
    /// Shown once, when an edit converts the deck to format version 2.
    @State private var migratedNotice = false
    /// Suggestions the host dismissed; kept in memory only.
    @State private var dismissedSuggestions: Set<String> = []
    /// `suggestRelations` for the loaded cards, recomputed when they change rather than on every redraw.
    @State private var relationSuggestions: [RelationSuggestion] = []

    private var deck: Deck? { store.deck }

    var body: some View {
        NavigationSplitView {
            if let deck {
                List(selection: $selectedCardID) {
                    Section {
                        ForEach(deck.cards) { card in
                            NavigationLink(value: card.id) {
                                HStack(spacing: 12) {
                                    YearChip(year: card.gameYear.value)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(card.title).font(.headline)
                                        Text(card.artist).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.vertical, 5)
                            }
                        }
                    } header: {
                        Text("\(deck.cards.count) cards · local collection")
                    }
                    let suggestions = relationSuggestions.filter { !dismissedSuggestions.contains(suggestionKey($0)) }
                    if !suggestions.isEmpty {
                        Section {
                            DisclosureGroup("Suggested linked recordings (\(suggestions.count))") {
                                Text("These come from matching titles. Check each one before linking.").font(.caption).foregroundStyle(.secondary)
                                ForEach(suggestions, id: \.cardId) { suggestion in
                                    suggestionRow(suggestion, deck)
                                }
                            }
                        }
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    Wordmark(era: deck.cards.first { $0.id == selectedCardID }.flatMap { Eras.for($0.gameYear.value) })
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Stage.ink)
                }
                .navigationSplitViewColumnWidth(min: 220, ideal: 280, max: 360)
                .navigationTitle(deck.title)
            } else {
                ContentUnavailableView("No deck loaded", systemImage: "rectangle.stack", description: Text("Import a deck JSON file to begin."))
            }
        } detail: {
            if let card = deck?.cards.first(where: { $0.id == selectedCardID }) {
                CardDetail(card: card, deckId: deck?.id ?? "", otherCards: deck?.cards.filter { $0.id != card.id } ?? [], onSaveYear: { year in
                    guard let current = deck else { return }
                    store.deck = try current.updatingGameYear(year, forCardID: card.id)
                }, onSaveGameFields: { clip, difficulty, related in
                    guard let current = deck else { return }
                    apply(try current.updatingGameFields(clip: clip, difficulty: difficulty, relatedTo: related, forCardID: card.id))
                })
                .id(card.id)
            } else {
                ContentUnavailableView("Choose a card", systemImage: "music.note.list", description: Text("Review its year, evidence, and QR preview."))
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { showImporter = true } label: { Label("Import JSON", systemImage: "square.and.arrow.down") }
                Button {
                    guard let deck else { return }
                    exportDocument = DeckDocument(deck: deck)
                    showExporter = true
                } label: { Label("Export JSON", systemImage: "square.and.arrow.up") }
                .disabled(deck == nil)
                Button { showDefaultClipStart = true } label: { Label("Default clip start", systemImage: "timer") }
                    .disabled(deck == nil)
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= DeckCodec.maximumBytes else { throw DeckError("Deck exceeds the 8 MiB import limit.") }
                let imported = try DeckCodec.decode(Data(contentsOf: url))
                store.deck = imported
                selectedCardID = imported.cards.first?.id
            } catch { errorMessage = error.localizedDescription }
        }
        .fileExporter(isPresented: $showExporter, document: exportDocument, contentType: .json, defaultFilename: deck?.id ?? "deck") { result in
            if case .failure(let error) = result { errorMessage = error.localizedDescription }
        }
        .sheet(isPresented: $showDefaultClipStart) {
            if let deck {
                DefaultClipStartEditor(deck: deck) { ms in apply(try deck.updatingDefaultClipStart(ms)) }
            }
        }
        .onChange(of: store.deck?.cards, initial: true) { relationSuggestions = deck.map { RelationSuggestions.suggestRelations($0.cards) } ?? [] }
        .alert("Saved as deck format 2; older Eratic versions can't open it.", isPresented: $migratedNotice) {
            Button("OK", role: .cancel) {}
        }
        .alert("Couldn’t open or save deck", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .task {
            guard deck == nil else { return }
            do {
                try store.loadSampleIfNeeded()
                #if os(macOS)
                selectedCardID = deck?.cards.first?.id
                #endif
            } catch { errorMessage = error.localizedDescription }
        }
    }

    private func suggestionKey(_ suggestion: RelationSuggestion) -> String { "\(suggestion.cardId)\n\(suggestion.relatedTo)" }

    @ViewBuilder
    private func suggestionRow(_ suggestion: RelationSuggestion, _ deck: Deck) -> some View {
        if let card = deck.card(suggestion.cardId), let original = deck.card(suggestion.relatedTo) {
            let relation = suggestion.relation == .remasterOf ? "remaster of" : "cover of"
            VStack(alignment: .leading, spacing: 6) {
                Text("\(card.title) — \(relation) \(original.title) (\(String(original.gameYear.value)))").font(.callout)
                HStack {
                    Button("Link") {
                        do {
                            apply(try deck.updatingGameFields(clip: card.clip, difficulty: card.difficulty,
                                                              relatedTo: RelatedCard(cardId: original.id, relation: suggestion.relation), forCardID: card.id))
                        } catch { errorMessage = error.localizedDescription }
                    }
                    Button("Dismiss") { dismissedSuggestions.insert(suggestionKey(suggestion)) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.vertical, 4)
        }
    }

    /// Stores an edited deck; the first edit that converts it to format 2 says so once.
    private func apply(_ updated: Deck) {
        if let current = deck, current.schemaVersion < 2, updated.schemaVersion >= 2 { migratedNotice = true }
        store.deck = updated
    }
}
