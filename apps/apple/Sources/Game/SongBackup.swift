import SwiftUI
import EraticCore

/// The song's backup for any playback tier: its QR to scan on a phone, and the hidden preview player.
/// `collapsed` tucks both behind a disclosure, for when exact clips are the main way to play.
struct SongBackup: View {
    let card: SongCard
    let collapsed: Bool
    /// Changing it remounts the preview, which stops it.
    var previewID: AnyHashable = 0
    @EnvironmentObject private var playback: PlaybackHub

    /// The chosen provider's link, else the card's first Spotify or Apple Music link, else its first link.
    private var url: URL? { Self.backupURL(for: card, provider: playback.provider) }

    static func backupURL(for card: SongCard, provider: PlaybackProvider) -> URL? {
        if provider != .manual, let url = PlayableTrack.from(card: card, provider: provider)?.url { return url }
        let known = card.links.lazy.compactMap { URL(string: $0.url) }.first { ScanRules.providerTrack($0.absoluteString) != nil }
        return known ?? PlayableTrack.from(card: card, provider: .manual)?.url
    }

    var body: some View {
        if let url {
            if collapsed {
                DisclosureGroup("Backup: song QR and hidden preview") { content(url).padding(.top, 6) }
            } else {
                content(url)
            }
        }
    }

    // The QR lets a player start the song on their own phone, so the title never shows on the shared screen.
    private func content(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 6) {
                QRPreview(payload: url.absoluteString, size: 160, label: "QR code for this song")
                Text("Scan with a phone to play the song there.").font(.callout).foregroundStyle(.secondary)
            }
            EmbeddedPreview(url: url).id(previewID)
        }
    }
}

/// One backup for a set of cards: pick a letter, then its QR and preview; switching disposes the previous preview.
struct SetBackup: View {
    let cards: [CardRef]
    let deck: Deck
    let collapsed: Bool
    /// Changing it remounts the preview, which stops it (an exact clip started).
    let previewID: AnyHashable
    @State private var selected = 0

    var body: some View {
        // Letters follow the tiles; cards that left the deck are skipped.
        let entries = cards.enumerated().compactMap { index, ref in deck.card(ref.cardId).map { (index: index, song: $0) } }
        if !entries.isEmpty {
            let chosen = entries.first { $0.index == selected } ?? entries[0]
            VStack(alignment: .leading, spacing: 8) {
                Picker("Backup for song", selection: Binding(get: { chosen.index }, set: { selected = $0 })) {
                    ForEach(entries, id: \.index) { Text(tileLetter($0.index)).tag($0.index) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)
                SongBackup(card: chosen.song, collapsed: collapsed, previewID: previewID).id(chosen.song.id)
            }
        }
    }
}
