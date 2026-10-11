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
  // Plays lengthMs from fromSeconds in the loaded player, then stops by itself.
  // onAudible runs once, when audio is first heard; a pause, another request or
  // dispose cancels it for good.
  snippet(fromSeconds: number, lengthMs: number, onAudible: () => void): void;
  dispose(): void;
}
// A running snippet: onset is the first audible progress; the stop follows from there.
// `before` (Spotify, ms): where the player was when the snippet was asked for. Reports at or past it are
// stale snapshots from before the rewind, until a paused report, a lower position or `staleTimer` (1.5 s).
type Snippet = {
  from: number; length: number; onAudible: () => void; onset: boolean;
  before?: number; staleTimer?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setTimeout>;
};
export type PreviewOptions = { autoplay?: boolean; progress?: (progress: PreviewProgress) => void };

// Inspired by HITSTER's distinct embed fallback; independently implemented with
// Spotify's public iframe API. It is NOT an exact-clip Player (ATTRIBUTION.md).
export class SpotifyPreviewSession implements PreviewSession {
  private controller?: SpotifyEmbedController;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private autoTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private pendingStart = false;
  private pauseRequested = false;
  private position = 0;
  private duration = 0;
  private clip?: Snippet;

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
          if (options.autoplay) this.autoplay();
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
          this.followSnippet(data);
          // Spotify accepted the play request: no retry; the original 12 s deadline still applies.
          if (!data.isPaused) clearTimeout(this.autoTimer);
          // A successful play request isn't evidence that audio has started.
          if (!data.isPaused && !data.isBuffering && (data.position ?? 0) > 0) {
            this.started = true;
            this.pendingStart = false;
            this.update("playing");
          } else if (data.isPaused && this.started && !this.pendingStart) {
            // The preview ended before the snippet's length.
            if (this.clip?.onset) this.cancelSnippet();
            this.update("paused");
          }
        });
        controller.addListener("error", () => this.update("error"));
      });
    }).catch(() => this.update("error"));
  }

  private cancelSnippet() {
    clearTimeout(this.clip?.timer);
    clearTimeout(this.clip?.staleTimer);
    this.clip = undefined;
  }
  // Onset is the first unpaused, unbuffered report past the snippet's start.
  private followSnippet(data: { isPaused?: boolean; isBuffering?: boolean; position?: number }) {
    const clip = this.clip;
    if (!clip) return;
    const at = data.position ?? 0;
    const from = clip.from * 1000;
    if (!clip.onset) {
      if (clip.before !== undefined) {
        if (!data.isPaused && at >= clip.before) return;
        clip.before = undefined;
      }
      if (data.isPaused || data.isBuffering || at <= from) return;
      clip.onset = true;
      clip.onAudible();
      if (this.clip !== clip) return;
      clip.timer = setTimeout(() => this.stopSnippet(clip), Math.max(0, clip.length - (at - from)));
    }
    if (at >= from + clip.length) this.stopSnippet(clip);
  }
  private stopSnippet(clip: Snippet) {
    if (this.clip === clip) this.pause();
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
  // Spotify can drop a play() sent right at "ready", and a browser may refuse audio
  // once the host's click is too old. Retry once; if still silent, offer Play (a
  // fresh host gesture) instead of a "starting" state that never starts.
  private autoplay() {
    this.play();
    this.autoTimer = setTimeout(() => {
      if (this.disposed || this.started || !this.pendingStart) return;
      try { this.controller?.play(); } catch { this.update("error"); return; }
      this.autoTimer = setTimeout(() => {
        if (this.disposed || this.started || !this.pendingStart) return;
        this.pendingStart = false;
        this.update("ready");
      }, 4_000);
    }, 2_000);
  }
  private begin(start: (controller: SpotifyEmbedController) => void) {
    if (this.disposed || !this.controller) return;
    clearTimeout(this.autoTimer);
    this.pendingStart = true;
    this.pauseRequested = false;
    this.notify("starting");
    this.deadline();
    try { start(this.controller); } catch { this.update("error"); }
  }
  play() {
    this.cancelSnippet();
    this.begin((controller) => {
      if (!this.started) controller.play();
      else if (this.duration > 0 && this.position >= this.duration - 0.5) controller.restart();
      else controller.resume();
    });
  }
  restart() {
    this.cancelSnippet();
    this.begin((controller) => controller.restart());
  }
  snippet(fromSeconds: number, lengthMs: number, onAudible: () => void) {
    if (this.disposed || !this.controller || !Number.isFinite(fromSeconds) || !(lengthMs > 0)) return;
    this.cancelSnippet();
    this.clip = { from: Math.max(0, fromSeconds), length: lengthMs, onAudible, onset: false,
      // Only a position well past the start can be told apart from the rewound snippet.
      ...(this.started && this.position * 1000 - fromSeconds * 1000 >= 500 && { before: this.position * 1000 }) };
    const clip = this.clip;
    if (clip.before !== undefined) clip.staleTimer = setTimeout(() => { clip.before = undefined; }, 1500);
    const from = this.clip.from;
    this.begin((controller) => {
      if (from > 0) {
        controller.seek(from);
        if (this.started) controller.resume(); else controller.play();
      } else if (this.started) controller.restart();
      else controller.play();
    });
  }
  seek(seconds: number) {
    if (this.disposed || !this.controller || !Number.isFinite(seconds)) return;
    const target = Math.max(0, this.duration > 0 ? Math.min(seconds, this.duration) : seconds);
    try { this.controller.seek(target); } catch { return; }
    this.position = target;
    this.options.progress?.({ position: target, duration: this.duration });
  }
  pause() {
    this.cancelSnippet();
    clearTimeout(this.autoTimer);
    this.pendingStart = false;
    this.pauseRequested = true;
    try { this.controller?.pause(); this.update("paused"); } catch { this.update("error"); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSnippet();
    clearTimeout(this.timer);
    clearTimeout(this.autoTimer);
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
  private clip?: Snippet;

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
    const progress = () => {
      this.options.progress?.({
        position: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
      this.followSnippet(audio);
    };
    on("canplay", () => {
      if (this.canPlay) return;
      this.canPlay = true;
      this.update("ready");
      if (this.options.autoplay) this.play();
    });
    on("playing", () => {
      this.update("playing");
      this.followSnippet(audio);
    });
    on("waiting", () => {
      // A repeated waiting event must not extend an already running deadline.
      if (this.state !== "playing") return;
      this.update("starting");
      this.deadline();
    });
    // A queued pause from the previous command must not cancel a newer play's deadline.
    on("pause", () => { if (audio.paused) this.update("paused"); });
    on("ended", () => {
      this.cancelSnippet();
      this.update("paused");
    });
    on("error", () => this.finish("error"));
    for (const name of ["timeupdate", "durationchange", "loadedmetadata"]) on(name, progress);
    audio.preload = "auto";
    audio.src = src;
  }
  private cancelSnippet() {
    clearTimeout(this.clip?.timer);
    this.clip = undefined;
  }
  // Onset is the first `playing` event, or a timeupdate past the snippet's start while unpaused.
  private followSnippet(audio: HTMLAudioElement) {
    const clip = this.clip;
    if (!clip || audio.paused) return;
    const at = (audio.currentTime || 0) * 1000;
    const from = clip.from * 1000;
    if (!clip.onset) {
      if (this.state !== "playing" && at <= from) return;
      clip.onset = true;
      // A replay while already playing may fire no `playing` event: end "starting" and its deadline here.
      if (this.state === "starting") this.update("playing");
      clip.onAudible();
      if (this.clip !== clip) return;
      clip.timer = setTimeout(() => this.stopSnippet(clip), Math.max(0, clip.length - Math.max(0, at - from)));
    }
    if (at >= from + clip.length) this.stopSnippet(clip);
  }
  private stopSnippet(clip: Snippet) {
    if (this.clip === clip) this.pause();
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
    this.cancelSnippet();
    this.start();
  }
  private start() {
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
    this.cancelSnippet();
    this.audio.currentTime = 0;
    this.start();
  }
  snippet(fromSeconds: number, lengthMs: number, onAudible: () => void) {
    if (this.disposed || !this.audio || !Number.isFinite(fromSeconds) || !(lengthMs > 0)) return;
    this.cancelSnippet();
    this.clip = { from: Math.max(0, fromSeconds), length: lengthMs, onAudible, onset: false };
    this.audio.currentTime = this.clip.from;
    this.start();
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
    this.cancelSnippet();
    this.playRequest++;
    this.audio?.pause();
    this.update("paused");
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSnippet();
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
