import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct EraticApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor private var appDelegate: AppDelegate
    #endif
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
                .onAppear { appDelegate.deckStore = deckStore }
                #endif
        }
    }
}

#if os(macOS)
/// Asks before quitting would drop deck edits that were never exported.
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var deckStore: DeckStore?

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard deckStore?.hasUnsavedEdits == true else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Quit without exporting your deck edits?"
        alert.informativeText = "Deck edits exist only in memory. Cancel and use Export JSON to keep them."
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Quit")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }
}
#endif
