import SwiftUI
import EraticCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The deck both tabs share. Edits stay in memory until the deck is exported.
@MainActor
final class DeckStore: ObservableObject {
    @Published var deck: Deck?

    /// Loads the bundled sample deck when nothing is loaded yet.
    func loadSampleIfNeeded() throws {
        guard deck == nil else { return }
        guard let url = Bundle.main.url(forResource: "demo-deck", withExtension: "json") else { throw DeckError("Bundled sample is missing.") }
        deck = try DeckCodec.decode(Data(contentsOf: url))
    }
}

/// Opens a link outside the app: the manual player and "Play on Spotify" use it.
enum ExternalURL {
    @MainActor
    static func open(_ url: URL) {
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
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
