import SwiftUI

@main
struct EraticApp: App {
    @StateObject private var deckStore = DeckStore()
    @StateObject private var playback = PlaybackHub(openURL: { ExternalURL.open($0) })
    @StateObject private var game = GameController()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(deckStore)
                .environmentObject(playback)
                .environmentObject(game)
                #if os(macOS)
                .frame(minWidth: 780, minHeight: 600)
                #endif
        }
    }
}
