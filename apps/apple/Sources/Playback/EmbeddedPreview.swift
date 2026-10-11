import EraticCore
import SwiftUI
import WebKit

/// Provider previews are a fallback, never evidence of an exact game clip.
/// Independently implemented using public embeds; see docs/ATTRIBUTION.md.
/// Both providers play from a hidden player with host transport controls; the song is
/// only revealed if the host opens the player explicitly.
struct EmbeddedPreview: View {
    let url: URL
    @State private var loaded = false
    @State private var shown = false
    @State private var attempt = UUID()
    @State private var command = PreviewCommand()
    @State private var spotifyStatus = "loading"
    @State private var spotifyPosition = 0.0
    @State private var spotifyDuration = 0.0
    /// Apple Music only: the revealing embed, offered when no hidden preview is available.
    @State private var embedFallback = false
    @State private var scrubbing = false
    @State private var scrubPosition = 0.0
    @StateObject private var apple = ApplePreviewPlayer()
    @Environment(\.scenePhase) private var scenePhase

    private var track: ProviderTrack? { ScanRules.providerTrack(url.absoluteString) }
    private var spotify: Bool { track?.provider == .spotify }
    private var status: String { spotify ? spotifyStatus : apple.status }
    private var position: Double { spotify ? spotifyPosition : apple.position }
    private var duration: Double { spotify ? spotifyDuration : apple.duration }
    private var active: Bool { status == "playing" || status == "starting" }
    private var controllable: Bool { !["loading", "error", "unavailable"].contains(status) }

    var body: some View {
        if let track {
            VStack(alignment: .leading, spacing: 8) {
                if !loaded {
                    Button("Play preview") { start(track) }
                        .buttonStyle(.borderedProminent)
                } else {
                    if embedFallback {
                        Button("Stop preview") { stop() }
                    } else {
                        transport
                        Text(message).font(.callout)
                        if status == "error" {
                            Button("Retry preview") { retry(track) }
                        }
                    }
                    if spotify || embedFallback {
                        Button(shown ? "Hide player" : "Show player (reveals song)") { shown.toggle() }
                    } else if status == "unavailable" || status == "error" {
                        Button("Show Apple Music player (reveals song)") { embedFallback = true; shown = true }
                    }
                    if spotify || embedFallback {
                        PreviewWebView(track: track, url: url, command: command, autoplay: true,
                                       report: { if spotify { spotifyStatus = $0 } },
                                       progress: { if spotify { spotifyPosition = $0; spotifyDuration = $1 } })
                            .id(attempt)
                            .frame(height: shown ? (spotify ? 152 : 175) : 1)
                            .opacity(shown ? 1 : 0)
                            .allowsHitTesting(shown)
                            .accessibilityHidden(!shown)
                    }
                }
                Text(spotify
                     ? "Preview via Spotify. Availability and length depend on Spotify."
                     : embedFallback
                     ? "Host only: use Play inside the player, then hide it while guessing. If no preview is available, use the QR/song link."
                     : "Preview via Apple Music. Usually 30 seconds; availability depends on Apple.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .onDisappear { teardown() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { teardown() }
            }
        }
    }

    private var transport: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button(active ? "Pause" : "Play") { toggle() }
                    .buttonStyle(.borderedProminent)
                Button { seek(to: position - 10) } label: {
                    Image(systemName: "gobackward.10")
                }
                .accessibilityLabel("Back 10 seconds")
                Button("Restart") { restart() }
            }
            .disabled(!controllable)
            HStack {
                Slider(value: Binding(get: { scrubbing ? scrubPosition : min(position, max(duration, 1)) },
                                      set: { scrubPosition = $0 }),
                       in: 0...max(duration, 1)) { editing in
                    // Start from the current position so a tap without a drag doesn't jump.
                    if editing, !scrubbing { scrubPosition = position }
                    scrubbing = editing
                    if !editing { seek(to: scrubPosition) }
                }
                .disabled(!controllable || duration <= 0)
                .accessibilityLabel("Preview position")
                Text("\(Self.clock(scrubbing ? scrubPosition : position)) / \(Self.clock(duration))")
                    .font(.callout.monospacedDigit())
            }
        }
    }

    private static func clock(_ seconds: Double) -> String {
        let whole = seconds.isFinite ? max(Int(seconds), 0) : 0
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }

    private func start(_ track: ProviderTrack) {
        scrubbing = false
        if spotify {
            spotifyStatus = "loading"
            spotifyPosition = 0
            spotifyDuration = 0
            attempt = UUID()
        } else {
            apple.load(id: track.id, storefront: track.storefront ?? "us", autoplay: true)
        }
        embedFallback = false
        shown = false
        loaded = true
    }

    private func retry(_ track: ProviderTrack) { start(track) }

    private func stop() {
        apple.dispose()
        loaded = false
        embedFallback = false
        shown = false
    }

    private func teardown() {
        stop()
        scrubbing = false
    }

    private func toggle() {
        if spotify {
            command = PreviewCommand(action: active ? "pause" : "play")
        } else if active {
            apple.pause()
        } else {
            apple.play()
        }
    }

    private func restart() {
        if spotify { command = PreviewCommand(action: "restart") } else { apple.restart() }
    }

    private func seek(to seconds: Double) {
        let target = seconds.isFinite ? max(seconds, 0) : 0
        if spotify { command = PreviewCommand(action: "seek", seconds: target) } else { apple.seek(to: target) }
    }

    private var message: String {
        switch status {
        case "ready": return "Preview ready. Song details stay hidden."
        case "starting": return "Starting preview…"
        case "playing": return "Preview playing"
        case "paused": return "Preview stopped"
        case "unavailable": return "No hidden preview for this song."
        case "error":
            return spotify
                ? "The preview could not play. Retry, show Spotify's player, or use the QR/song link."
                : "The preview could not load. Retry, show Apple Music's player, or use the QR/song link."
        default: return spotify ? "Loading Spotify preview…" : "Loading Apple Music preview…"
        }
    }
}

private struct PreviewCommand {
    var id = UUID()
    var action = ""
    var seconds = 0.0
}

/// Narrow WebKit boundary: recognized provider URLs only, no deck HTML or credentials.
private struct PreviewWebView {
    let track: ProviderTrack
    let url: URL
    let command: PreviewCommand
    /// Baked into the Spotify bridge: start playing as soon as the player is ready.
    let autoplay: Bool
    let report: (String) -> Void
    let progress: (Double, Double) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(report: report, progress: progress) }

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
            webView.loadHTMLString(Self.spotifyHTML(id: track.id, autoplay: autoplay), baseURL: URL(string: "https://open.spotify.com"))
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
        coordinator.progress = progress
        guard coordinator.lastCommand != command.id else { return }
        coordinator.lastCommand = command.id
        let script: String
        switch command.action {
        case "play", "pause", "restart":
            script = "window.eraticPreview?.\(command.action)()"
        case "seek":
            // Numbers only, formatted here and never interpolated from a string.
            guard command.seconds.isFinite else { return }
            let seconds = min(max(command.seconds, 0), 36_000)
            script = "window.eraticPreview?.seek(\(String(format: "%.3f", seconds)))"
        default:
            return
        }
        webView.evaluateJavaScript(script) { _, error in
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
        var progress: (Double, Double) -> Void
        var lastCommand: UUID?
        var disposed = false
        init(report: @escaping (String) -> Void, progress: @escaping (Double, Double) -> Void) {
            self.report = report
            self.progress = progress
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !disposed, message.frameInfo.isMainFrame else { return }
            if let state = message.body as? String {
                guard ["loading", "ready", "starting", "playing", "paused", "error"].contains(state) else { return }
                report(state)
            } else if let values = message.body as? [String: Any],
                      let position = values["position"] as? Double, let duration = values["duration"] as? Double,
                      position.isFinite, duration.isFinite, position >= 0, duration >= 0 {
                progress(position, duration)
            }
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

    private static func spotifyHTML(id: String, autoplay: Bool) -> String {
        // ScanRules has already restricted id to 22 ASCII letters/digits.
        """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;background:transparent}iframe{border:0}</style></head><body><div id="player"></div>
        <script>
        const autoplay=\(autoplay ? "true" : "false");
        let controller, timer, started=false, pending=false, disposed=false, lastPos=0, lastDur=0;
        const send=s=>{if(!disposed)window.webkit.messageHandlers.preview.postMessage(s)};
        const update=s=>{clearTimeout(timer);send(s)};
        const fail=()=>{pending=false;try{controller?.pause()}catch{}update('error')};
        const deadline=()=>{clearTimeout(timer);timer=setTimeout(fail,12000)};
        window.eraticPreview={
          play(){if(!controller)return;pending=true;send('starting');deadline();
            try{if(!started)controller.play();else if(lastDur>0&&lastPos>=lastDur-500)controller.restart();else controller.resume()}catch{fail()}},
          restart(){if(!controller)return;pending=true;send('starting');deadline();try{controller.restart()}catch{fail()}},
          seek(s){if(!controller||!Number.isFinite(s))return;try{controller.seek(s)}catch{fail()}},
          pause(){pending=false;try{controller?.pause();update('paused')}catch{fail()}},
          dispose(){disposed=true;clearTimeout(timer);try{controller?.pause()}catch{}try{controller?.destroy()}catch{}}
        };
        deadline();
        window.onSpotifyIframeApiReady=api=>{
          if(disposed)return;
          api.createController(document.getElementById('player'),{uri:'spotify:track:\(id)',width:'100%',height:152},c=>{
            if(disposed){c.destroy();return}controller=c;
            c.addListener('ready',()=>{update('ready');if(autoplay)window.eraticPreview.play()});
            c.addListener('error',fail);
            c.addListener('playback_update',({data:d})=>{
              if(!d)return;
              if(Number.isFinite(d.position)&&Number.isFinite(d.duration)){lastPos=d.position;lastDur=d.duration;
                if(!disposed)window.webkit.messageHandlers.preview.postMessage({position:Math.max(d.position,0)/1000,duration:Math.max(d.duration,0)/1000})}
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
