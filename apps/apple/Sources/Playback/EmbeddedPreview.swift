import EraticCore
import SwiftUI
import WebKit

/// Provider previews are a fallback, never evidence of an exact game clip.
/// Independently implemented using public embeds; see docs/ATTRIBUTION.md.
struct EmbeddedPreview: View {
    let url: URL
    @State private var loaded = false
    @State private var shown = false
    @State private var attempt = UUID()
    @State private var command = PreviewCommand()
    @State private var status = "loading"
    @Environment(\.scenePhase) private var scenePhase

    private var track: ProviderTrack? { ScanRules.providerTrack(url.absoluteString) }
    private var spotify: Bool { track?.provider == .spotify }
    private var active: Bool { status == "playing" || status == "starting" }

    var body: some View {
        if let track {
            VStack(alignment: .leading, spacing: 8) {
                if !loaded {
                    Button(spotify ? "Load preview" : "Show Apple Music preview (reveals song)") {
                        status = "loading"
                        shown = !spotify
                        loaded = true
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    if spotify {
                        HStack {
                            Button(active ? "Stop preview" : status == "paused" ? "Replay preview" : "Play preview") {
                                command = PreviewCommand(action: active ? "pause" : "play")
                            }
                            .disabled(status == "loading" || status == "error")
                            if status == "error" {
                                Button("Retry preview") { status = "loading"; attempt = UUID() }
                            }
                        }
                        Text(message).font(.callout)
                    } else {
                        if status == "error" { Text("The preview could not load. Stop and try again, or use the QR/song link.").font(.callout) }
                        Button("Stop preview") { loaded = false; shown = false }
                    }
                    Button(shown ? "Hide player" : "Show player (reveals song)") { shown.toggle() }
                    PreviewWebView(track: track, url: url, command: command) { status = $0 }
                        .id(attempt)
                        .frame(height: shown ? (spotify ? 152 : 175) : 1)
                        .opacity(shown ? 1 : 0)
                        .allowsHitTesting(shown)
                        .accessibilityHidden(!shown)
                }
                Text(spotify
                     ? "Preview via Spotify. Availability and length depend on Spotify."
                     : "Host only: use Play inside the player, then hide it while guessing. If no preview is available, use the QR/song link.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .onDisappear { loaded = false }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { loaded = false; shown = false }
            }
        }
    }

    private var message: String {
        switch status {
        case "ready": return "Preview ready. Song details stay hidden."
        case "starting": return "Starting preview…"
        case "playing": return "Preview playing"
        case "paused": return "Preview stopped"
        case "error": return "The preview could not play. Retry, show Spotify's player, or use the QR/song link."
        default: return "Loading Spotify preview…"
        }
    }
}

private struct PreviewCommand {
    var id = UUID()
    var action = ""
}

/// Narrow WebKit boundary: recognized provider URLs only, no deck HTML or credentials.
private struct PreviewWebView {
    let track: ProviderTrack
    let url: URL
    let command: PreviewCommand
    let report: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(report: report) }

    func makeWebView(_ coordinator: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        #if os(iOS)
        configuration.allowsInlineMediaPlayback = true
        #endif
        // Playback is still explicitly requested by the host. A SwiftUI button does
        // not carry a DOM user gesture into evaluateJavaScript.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(coordinator, name: "preview")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = coordinator
        coordinator.lastCommand = command.id
        if track.provider == .spotify {
            webView.loadHTMLString(Self.spotifyHTML(id: track.id), baseURL: URL(string: "https://open.spotify.com"))
        } else if var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.host = "embed.music.apple.com"
            components.queryItems = components.queryItems?.filter { $0.name == "i" }
            components.fragment = nil
            if let embedURL = components.url { webView.load(URLRequest(url: embedURL)) }
        }
        return webView
    }

    func update(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.report = report
        guard coordinator.lastCommand != command.id else { return }
        coordinator.lastCommand = command.id
        guard command.action == "play" || command.action == "pause" else { return }
        webView.evaluateJavaScript("window.eraticPreview?.\(command.action)()") { _, error in
            if error != nil { coordinator.report("error") }
        }
    }

    static func dismantle(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.disposed = true
        webView.evaluateJavaScript("window.eraticPreview?.dispose()", completionHandler: nil)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "preview")
        webView.navigationDelegate = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var report: (String) -> Void
        var lastCommand: UUID?
        var disposed = false
        init(report: @escaping (String) -> Void) { self.report = report }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !disposed, message.frameInfo.isMainFrame, let state = message.body as? String,
                  ["loading", "ready", "starting", "playing", "paused", "error"].contains(state) else { return }
            report(state)
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if !disposed { report("error") }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if !disposed { report("error") }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Keep clicked song/sign-in links out of the shared embedded surface.
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
                if url.scheme == "https" { ExternalURL.open(url) }
                decisionHandler(.cancel)
            } else { decisionHandler(.allow) }
        }
    }

    private static func spotifyHTML(id: String) -> String {
        // ScanRules has already restricted id to 22 ASCII letters/digits.
        """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;background:transparent}iframe{border:0}</style></head><body><div id="player"></div>
        <script>
        let controller, timer, started=false, pending=false, disposed=false;
        const send=s=>{if(!disposed)window.webkit.messageHandlers.preview.postMessage(s)};
        const update=s=>{clearTimeout(timer);send(s)};
        const fail=()=>{pending=false;try{controller?.pause()}catch{}update('error')};
        const deadline=()=>{clearTimeout(timer);timer=setTimeout(fail,12000)};
        window.eraticPreview={
          play(){if(!controller)return;pending=true;send('starting');deadline();try{started?controller.restart():controller.play()}catch{fail()}},
          pause(){pending=false;try{controller?.pause();update('paused')}catch{fail()}},
          dispose(){disposed=true;clearTimeout(timer);try{controller?.pause()}catch{}try{controller?.destroy()}catch{}}
        };
        deadline();
        window.onSpotifyIframeApiReady=api=>{
          if(disposed)return;
          api.createController(document.getElementById('player'),{uri:'spotify:track:\(id)',width:'100%',height:152},c=>{
            if(disposed){c.destroy();return}controller=c;
            c.addListener('ready',()=>update('ready'));
            c.addListener('error',fail);
            c.addListener('playback_update',({data:d})=>{
              if(!d)return;
              if(!d.isPaused&&!d.isBuffering&&d.position>0){started=true;pending=false;update('playing')}
              else if(d.isPaused&&started&&!pending)update('paused');
            });
          });
        };
        </script><script src="https://open.spotify.com/embed/iframe-api/v1" onerror="fail()"></script></body></html>
        """
    }
}

#if os(macOS)
extension PreviewWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) { update(view, coordinator: context.coordinator) }
    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) { dismantle(view, coordinator: coordinator) }
}
#else
extension PreviewWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) { update(view, coordinator: context.coordinator) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { dismantle(view, coordinator: coordinator) }
}
#endif
