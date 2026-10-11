import { providerTrack } from "../core/scan";

export type PreviewTarget = { provider: "spotify"; id: string } | { provider: "appleMusic"; url: string };

// Only recognized song URLs become embeds. Never frame arbitrary deck URLs.
export function previewTarget(url: string): PreviewTarget | undefined {
  const track = providerTrack(url);
  if (!track) return undefined;
  if (track.provider === "spotify") return { provider: "spotify", id: track.id };
  const source = new URL(url);
  const embed = new URL(source.pathname, "https://embed.music.apple.com");
  const song = source.searchParams.get("i");
  if (song) embed.searchParams.set("i", song);
  return { provider: "appleMusic", url: embed.href };
}

export interface SpotifyEmbedController {
  play(): void;
  pause(): void;
  restart(): void;
  destroy(): void;
  addListener(event: string, listener: (event: { data?: {
    isPaused?: boolean; isBuffering?: boolean; position?: number; duration?: number;
  } }) => void): void;
}
export interface SpotifyEmbedAPI {
  createController(element: HTMLElement, options: { uri: string; width: string; height: number },
    callback: (controller: SpotifyEmbedController) => void): void;
}
// Spotify's current loader requires eval. Give its bridge a separate document
// policy so the main app retains its no-eval CSP. This same-origin bridge loads
// trusted provider code; it is not a storage or security isolation boundary.
const frameAPI: SpotifyEmbedAPI = {
  createController(element, options, callback) {
    const frame = document.createElement("iframe");
    frame.title = "Spotify preview player";
    frame.width = options.width;
    frame.height = String(options.height);
    frame.allow = "autoplay; encrypted-media";
    const id = options.uri.slice("spotify:track:".length);
    frame.src = new URL(`spotify-preview.html#${encodeURIComponent(id)}`, document.baseURI).href;
    const listeners = new Map<string, Parameters<SpotifyEmbedController["addListener"]>[1]>();
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== "eratic-preview") return;
      const { name, data } = event.data;
      if (["ready", "playback_update", "error"].includes(name)) listeners.get(name)?.({ data });
    };
    window.addEventListener("message", receive);
    const send = (command: string) => frame.contentWindow?.postMessage({ channel: "eratic-preview", command }, location.origin);
    element.replaceWith(frame);
    callback({
      play: () => send("play"), pause: () => send("pause"), restart: () => send("restart"),
      destroy: () => { window.removeEventListener("message", receive); frame.remove(); listeners.clear(); },
      addListener: (event, listener) => { listeners.set(event, listener); },
    });
  },
};

export type PreviewState = "loading" | "ready" | "starting" | "playing" | "paused" | "error";

// Inspired by HITSTER's distinct embed fallback; independently implemented with
// Spotify's public iframe API. It is NOT an exact-clip Player (ATTRIBUTION.md).
export class SpotifyPreviewSession {
  private controller?: SpotifyEmbedController;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private pendingStart = false;

  constructor(private host: HTMLElement, id: string,
    private notify: (state: PreviewState) => void,
    load: () => Promise<SpotifyEmbedAPI> = async () => frameAPI) {
    this.notify("loading");
    this.deadline();
    void load().then((api) => {
      if (this.disposed) return;
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      api.createController(mount, { uri: `spotify:track:${id}`, width: "100%", height: 152 }, (controller) => {
        if (this.disposed) { try { controller.destroy(); } catch { /* Already detached. */ } return; }
        this.controller = controller;
        controller.addListener("ready", () => this.update("ready"));
        controller.addListener("playback_update", ({ data }) => {
          if (!data) return;
          // A successful play request isn't evidence that audio has started.
          if (!data.isPaused && !data.isBuffering && (data.position ?? 0) > 0) {
            this.started = true;
            this.pendingStart = false;
            this.update("playing");
          } else if (data.isPaused && this.started && !this.pendingStart) this.update("paused");
        });
        controller.addListener("error", () => {
          try { controller.pause(); } catch { /* Keep the fallback available. */ }
          this.update("error");
        });
      });
    }).catch(() => this.update("error"));
  }

  private update(state: PreviewState) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.notify(state);
  }
  private deadline() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.pendingStart = false;
      try { this.controller?.pause(); } catch { /* Surface the timeout below. */ }
      this.update("error");
    }, 12_000);
  }
  play() {
    if (this.disposed || !this.controller) return;
    this.pendingStart = true;
    this.notify("starting");
    this.deadline();
    try {
      if (this.started) this.controller.restart();
      else this.controller.play();
    } catch { this.update("error"); }
  }
  pause() {
    this.pendingStart = false;
    try { this.controller?.pause(); this.update("paused"); } catch { this.update("error"); }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    try { this.controller?.pause(); } catch { /* Teardown must continue. */ }
    try { this.controller?.destroy(); } catch { /* Remove the frame anyway. */ }
    this.host.replaceChildren();
  }
}
