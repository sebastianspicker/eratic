import SwiftUI
import EraticCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The deck both tabs share. Edits stay in memory until the deck is exported (ADR 0005).
@MainActor
final class DeckStore: ObservableObject {
    @Published private(set) var deck: Deck?
    /// An edit was made since the deck was loaded or last exported; quitting or importing would lose it.
    @Published private(set) var hasUnsavedEdits = false

    /// Loads the bundled sample deck when nothing is loaded yet.
    func loadSampleIfNeeded() throws {
        guard deck == nil else { return }
        guard let url = Bundle.main.url(forResource: "demo-deck", withExtension: "json") else { throw DeckError("Bundled sample is missing.") }
        deck = try DeckCodec.decode(Data(contentsOf: url))
    }

    func edit(_ updated: Deck) {
        deck = updated
        hasUnsavedEdits = true
    }

    /// An imported deck: nothing unsaved yet.
    func replace(with imported: Deck) {
        deck = imported
        hasUnsavedEdits = false
    }

    /// The export wrote `exported`; unchanged since then means nothing is unsaved.
    func exported(_ exported: Deck) {
        if deck == exported { hasUnsavedEdits = false }
    }
}

/// Opens a link outside the app: the manual player and "Play on Spotify" use it.
enum ExternalURL {
    @MainActor
    static func open(_ url: URL) {
        let track = ScanRules.providerTrack(url.absoluteString)
        #if os(iOS)
        if let track, track.provider == .spotify,
           let appURL = URL(string: "spotify:track:\(track.id)") {
            // Ask the installed app first; a missing app falls back to the supplied HTTPS link.
            UIApplication.shared.open(appURL) { opened in
                if !opened { UIApplication.shared.open(url) }
            }
            return
        }
        UIApplication.shared.open(url)
        #else
        if let track {
            let bundleID = track.provider == .spotify ? "com.spotify.client" : "com.apple.Music"
            if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                let target = track.provider == .spotify ? URL(string: "spotify:track:\(track.id)") ?? url : url
                NSWorkspace.shared.open([target], withApplicationAt: app, configuration: .init()) { _, error in
                    if error != nil { DispatchQueue.main.async { NSWorkspace.shared.open(url) } }
                }
                return
            }
        }
        NSWorkspace.shared.open(url)
        #endif
    }
}

/// Copies share text to the system pasteboard.
enum Clipboard {
    @MainActor
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

/// Deck and Play, the two top-level destinations. Switching keeps a game in progress.
struct RootView: View {
    private enum Destination { case deck, play }
    @State private var destination = Destination.deck

    var body: some View {
        TabView(selection: $destination) {
            DeckWorkspace()
                .tabItem { Label("Deck", systemImage: "rectangle.stack") }
                .tag(Destination.deck)
            PlayHome()
                .tabItem { Label("Play", systemImage: "play.circle") }
                .tag(Destination.play)
        }
    }
}
