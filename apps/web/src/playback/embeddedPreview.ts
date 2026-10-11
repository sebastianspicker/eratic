import { providerTrack } from "../core/scan";

export type PreviewTarget = { provider: "spotify"; id: string }
  | { provider: "appleMusic"; id: string; storefront: string; url: string };

// Only recognized song URLs become embeds. Never frame arbitrary deck URLs.
export function previewTarget(url: string): PreviewTarget | undefined {
  const track = providerTrack(url);
  if (!track) return undefined;
  if (track.provider === "spotify") return { provider: "spotify", id: track.id };
  const source = new URL(url);
  const embed = new URL(source.pathname, "https://embed.music.apple.com");
  const song = source.searchParams.get("i");
  if (song) embed.searchParams.set("i", song);
  return { provider: "appleMusic", id: track.id, storefront: track.storefront ?? "us", url: embed.href };
}

export interface SpotifyEmbedController {
  play(): void;
  pause(): void;
  resume(): void;
  seek(seconds: number): void;
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
    const send = (command: string, extra?: { seconds: number }) =>
      frame.contentWindow?.postMessage({ channel: "eratic-preview", command, ...extra }, location.origin);
    element.replaceWith(frame);
    callback({
      play: () => send("play"), pause: () => send("pause"), resume: () => send("resume"), restart: () => send("restart"),
      seek: (seconds) => send("seek", { seconds }),
      destroy: () => { window.removeEventListener("message", receive); frame.remove(); listeners.clear(); },
      addListener: (event, listener) => { listeners.set(event, listener); },
    });
  },
};

export type PreviewState = "loading" | "ready" | "starting" | "playing" | "paused" | "unavailable" | "error";
// Seconds.
export type PreviewProgress = { position: number; duration: number };
export interface PreviewSession {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  restart(): void;
  dispose(): void;
}
export type PreviewOptions = { autoplay?: boolean; progress?: (progress: PreviewProgress) => void };

// Inspired by HITSTER's distinct embed fallback; independently implemented with
// Spotify's public iframe API. It is NOT an exact-clip Player (ATTRIBUTION.md).
export class SpotifyPreviewSession implements PreviewSession {
  private controller?: SpotifyEmbedController;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private pendingStart = false;
  private pauseRequested = false;
  private position = 0;
  private duration = 0;

  constructor(private host: HTMLElement, id: string,
    private notify: (state: PreviewState) => void,
    private options: PreviewOptions & { load?: () => Promise<SpotifyEmbedAPI> } = {}) {
    const load = options.load ?? (async () => frameAPI);
    this.notify("loading");
    this.deadline();
    void load().then((api) => {
      if (this.disposed) return;
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      api.createController(mount, { uri: `spotify:track:${id}`, width: "100%", height: 152 }, (controller) => {
        if (this.disposed) { try { controller.destroy(); } catch { /* Already detached. */ } return; }
        this.controller = controller;
        controller.addListener("ready", () => {
          this.update("ready");
          if (options.autoplay) this.play();
        });
        controller.addListener("playback_update", ({ data }) => {
          if (!data || this.disposed) return;
          // Spotify reports milliseconds.
          this.position = (data.position ?? 0) / 1000;
          this.duration = (data.duration ?? 0) / 1000;
          this.options.progress?.({ position: this.position, duration: this.duration });
          // Ignore playback snapshots queued before the host's pause command.
          // Once Spotify acknowledges pause, its revealed player can control playback again.
          if (this.pauseRequested) {
            if (data.isPaused) this.pauseRequested = false;
            return;
          }
          // A successful play request isn't evidence that audio has started.
          if (!data.isPaused && !data.isBuffering && (data.position ?? 0) > 0) {
            this.started = true;
            this.pendingStart = false;
            this.update("playing");
          } else if (data.isPaused && this.started && !this.pendingStart) this.update("paused");
        });
        controller.addListener("error", () => this.update("error"));
      });
    }).catch(() => this.update("error"));
  }

  private update(state: PreviewState) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    if (state === "error") this.dispose();
    this.notify(state);
  }
  private deadline() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.pendingStart = false;
      this.update("error");
    }, 12_000);
  }
  private begin(start: (controller: SpotifyEmbedController) => void) {
    if (this.disposed || !this.controller) return;
    this.pendingStart = true;
    this.pauseRequested = false;
    this.notify("starting");
    this.deadline();
    try { start(this.controller); } catch { this.update("error"); }
  }
  play() {
    this.begin((controller) => {
      if (!this.started) controller.play();
      else if (this.duration > 0 && this.position >= this.duration - 0.5) controller.restart();
      else controller.resume();
    });
  }
  restart() { this.begin((controller) => controller.restart()); }
  seek(seconds: number) {
    if (this.disposed || !this.controller || !Number.isFinite(seconds)) return;
    const target = Math.max(0, this.duration > 0 ? Math.min(seconds, this.duration) : seconds);
    try { this.controller.seek(target); } catch { return; }
    this.position = target;
    this.options.progress?.({ position: target, duration: this.duration });
  }
  pause() {
    this.pendingStart = false;
    this.pauseRequested = true;
    try { this.controller?.pause(); this.update("paused"); } catch { this.update("error"); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    try { this.controller?.pause(); } catch { /* Teardown must continue. */ }
    try { this.controller?.destroy(); } catch { /* Remove the frame anyway. */ }
    this.host.replaceChildren();
  }
}

const isAppleHost = (host: string) => host === "apple.com" || host.endsWith(".apple.com");

// Apple has no documented control API for its embed. The public iTunes Lookup
// API's 30 s preview file gives full transport control without revealing the
// song. Only previewUrl is read; no song metadata enters the UI.
export class ApplePreviewSession implements PreviewSession {
  private audio?: HTMLAudioElement;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private abort = new AbortController();
  private state: PreviewState = "loading";
  private canPlay = false;
  private playRequest = 0;
  private listeners: [string, () => void][] = [];

  constructor(id: string, storefront: string, private notify: (state: PreviewState) => void,
    private options: PreviewOptions & { fetch?: typeof fetch; createAudio?: () => HTMLAudioElement } = {}) {
    this.update("loading");
    this.deadline();
    const lookup = new URL("https://itunes.apple.com/lookup");
    lookup.searchParams.set("id", id);
    lookup.searchParams.set("country", storefront);
    lookup.searchParams.set("entity", "song");
    const request = options.fetch ?? ((input, init) => fetch(input, init));
    void request(lookup.href, { signal: this.abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("lookup failed");
      const body = await response.json() as { results?: { wrapperType?: unknown; trackId?: unknown; previewUrl?: unknown }[] };
      if (this.disposed) return;
      const track = body.results?.find((item) => item?.wrapperType === "track" && String(item.trackId) === id);
      const src = this.previewSource(track?.previewUrl);
      if (!src) return this.finish("unavailable");
      this.attach(src);
    }).catch(() => this.finish("error"));
  }

  private previewSource(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && isAppleHost(url.hostname) ? url.href : undefined;
    } catch { return undefined; }
  }
  private attach(src: string) {
    const audio = this.options.createAudio?.() ?? new Audio();
    this.audio = audio;
    const on = (name: string, handler: () => void) => {
      audio.addEventListener(name, handler);
      this.listeners.push([name, handler]);
    };
    const progress = () => this.options.progress?.({
      position: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
    on("canplay", () => {
      if (this.canPlay) return;
      this.canPlay = true;
      this.update("ready");
      if (this.options.autoplay) this.play();
    });
    on("playing", () => this.update("playing"));
    on("waiting", () => {
      // A repeated waiting event must not extend an already running deadline.
      if (this.state !== "playing") return;
      this.update("starting");
      this.deadline();
    });
    // A queued pause from the previous command must not cancel a newer play's deadline.
    on("pause", () => { if (audio.paused) this.update("paused"); });
    on("ended", () => this.update("paused"));
    on("error", () => this.finish("error"));
    for (const name of ["timeupdate", "durationchange", "loadedmetadata"]) on(name, progress);
    audio.preload = "auto";
    audio.src = src;
  }
  private update(state: PreviewState) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.state = state;
    this.notify(state);
  }
  private deadline() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish("error"), 12_000);
  }
  private finish(state: "error" | "unavailable") {
    if (this.disposed) return;
    // End this attempt before pausing/aborting: both can queue callbacks. Only
    // an explicit retry creates a new session and can resume hidden playback.
    this.dispose();
    this.notify(state);
  }
  play() {
    const audio = this.audio;
    if (this.disposed || !audio) return;
    const request = ++this.playRequest;
    if (audio.ended || (Number.isFinite(audio.duration) && audio.duration > 0 && audio.currentTime >= audio.duration - 0.5)) audio.currentTime = 0;
    this.update("starting");
    this.deadline();
    try {
      void Promise.resolve(audio.play()).catch((error: unknown) => {
        if (this.disposed || request !== this.playRequest) return;
        const name = (error as { name?: string } | undefined)?.name;
        // A pause during startup aborts the request; that's not a failure.
        if (name === "AbortError") return;
        // Blocked autoplay: stay playable from the host's next Play press.
        if (name === "NotAllowedError") return this.update("ready");
        this.finish("error");
      });
    } catch { this.finish("error"); }
  }
  restart() {
    if (this.disposed || !this.audio) return;
    this.audio.currentTime = 0;
    this.play();
  }
  seek(seconds: number) {
    const audio = this.audio;
    if (this.disposed || !audio || !Number.isFinite(seconds)) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
    audio.currentTime = target;
    this.options.progress?.({ position: target, duration });
  }
  pause() {
    if (this.disposed) return;
    this.playRequest++;
    this.audio?.pause();
    this.update("paused");
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.abort.abort();
    const audio = this.audio;
    this.audio = undefined;
    if (!audio) return;
    try { audio.pause(); } catch { /* Teardown must continue. */ }
    for (const [name, handler] of this.listeners) audio.removeEventListener(name, handler);
    this.listeners = [];
    try { audio.removeAttribute("src"); audio.load(); } catch { /* Already released. */ }
  }
}
