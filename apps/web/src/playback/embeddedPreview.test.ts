// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplePreviewSession, previewTarget, SpotifyPreviewSession, type SpotifyEmbedAPI, type SpotifyEmbedController } from "./embeddedPreview";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function fixture() {
  const listeners: Record<string, (event: { data?: { isPaused?: boolean; isBuffering?: boolean; position?: number; duration?: number } }) => void> = {};
  const controller: SpotifyEmbedController = {
    play: vi.fn(), pause: vi.fn(), resume: vi.fn(), seek: vi.fn(), restart: vi.fn(), destroy: vi.fn(),
    addListener: vi.fn((name, handler) => { listeners[name] = handler; }),
  };
  const api: SpotifyEmbedAPI = { createController: vi.fn((_element, _options, callback) => callback(controller)) };
  const host = document.createElement("div");
  document.body.append(host);
  const state = vi.fn();
  return { host, controller, api, listeners, state };
}

describe("provider embed routing", () => {
  it("recognizes provider songs and drops Apple tracking fields", () => {
    expect(previewTarget("https://open.spotify.com/track/0123456789ABCDEFGHIJKL")).toEqual({provider: "spotify", id: "0123456789ABCDEFGHIJKL"});
    expect(previewTarget("https://music.apple.com/us/album/example/123?i=456&at=tracking#frag")).toEqual({provider: "appleMusic", id: "456", storefront: "us", url: "https://embed.music.apple.com/us/album/example/123?i=456"});
    expect(previewTarget("https://music.apple.com/us/song/example/456")).toEqual({provider: "appleMusic", id: "456", storefront: "us", url: "https://embed.music.apple.com/us/song/example/456"});
  });
  it("does not embed arbitrary hosts, albums, or invalid ids", () => {
    for (const url of ["https://example.com/song", "https://music.apple.com/us/album/example/123", "https://open.spotify.com/track/no", "javascript:alert(1)"]) expect(previewTarget(url)).toBeUndefined();
  });
});

describe("Spotify preview lifecycle", () => {
  it("does not autoplay; distinguishes ready, buffering, actual progress and replay", async () => {
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api});
    await Promise.resolve();
    f.listeners.ready({});
    expect(f.controller.play).not.toHaveBeenCalled();
    expect(f.state).toHaveBeenLastCalledWith("ready");
    session.play();
    expect(f.controller.play).toHaveBeenCalledOnce();
    f.listeners.playback_update({data: {isPaused: false, isBuffering: true, position: 200}});
    expect(f.state).toHaveBeenLastCalledWith("starting");
    f.listeners.playback_update({data: {isPaused: false, isBuffering: false, position: 200}});
    expect(f.state).toHaveBeenLastCalledWith("playing");
    session.pause();
    expect(f.state).toHaveBeenLastCalledWith("paused");
    session.play();
    expect(f.controller.resume).toHaveBeenCalledOnce();
    expect(f.controller.restart).not.toHaveBeenCalled();
    session.dispose();
  });
  it("autoplays on ready only when requested", async () => {
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api, autoplay: true});
    await Promise.resolve(); f.listeners.ready({});
    expect(f.controller.play).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("starting");
    session.dispose();
  });
  it("retries a silent autoplay once, then offers Play instead of starting forever", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api, autoplay: true});
    await vi.advanceTimersByTimeAsync(0); f.listeners.ready({});
    expect(f.state).toHaveBeenLastCalledWith("starting");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.controller.play).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(f.state).toHaveBeenLastCalledWith("ready");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.state).toHaveBeenLastCalledWith("ready");
    session.play();
    expect(f.controller.play).toHaveBeenCalledTimes(3);
    f.listeners.playback_update({data: {isPaused: false, position: 100}});
    expect(f.state).toHaveBeenLastCalledWith("playing");
    session.dispose();
  });
  it("keeps an accepted autoplay that is still buffering, and a host pause cancels the retry", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const buffering = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api, autoplay: true});
    await vi.advanceTimersByTimeAsync(0); f.listeners.ready({});
    f.listeners.playback_update({data: {isPaused: false, isBuffering: true, position: 0}});
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.controller.play).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("starting");
    buffering.dispose();
    const g = fixture();
    const paused = new SpotifyPreviewSession(g.host, "track", g.state, {load: async () => g.api, autoplay: true});
    await vi.advanceTimersByTimeAsync(0); g.listeners.ready({});
    paused.pause();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(g.controller.play).toHaveBeenCalledOnce();
    expect(g.state).toHaveBeenLastCalledWith("paused");
    paused.dispose();
  });
  it("ends an expired Spotify load so late readiness cannot autoplay", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, { load: async () => f.api, autoplay: true });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.controller.destroy).toHaveBeenCalledOnce();
    f.listeners.ready({});
    f.listeners.playback_update({ data: { isPaused: false, position: 200 } });
    expect(f.state).toHaveBeenLastCalledWith("error");
    expect(f.controller.play).not.toHaveBeenCalled();
    session.dispose();
  });
  it("converts progress to seconds, restarts at the end, seeks clamped, and restarts on request", async () => {
    const f = fixture(); const progress = vi.fn();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api, progress});
    await Promise.resolve(); f.listeners.ready({}); session.play();
    f.listeners.playback_update({data: {isPaused: false, position: 12_000, duration: 30_000}});
    expect(progress).toHaveBeenLastCalledWith({position: 12, duration: 30});
    session.seek(99); expect(f.controller.seek).toHaveBeenLastCalledWith(30);
    session.seek(-5); expect(f.controller.seek).toHaveBeenLastCalledWith(0);
    session.seek(7); expect(f.controller.seek).toHaveBeenLastCalledWith(7);
    expect(progress).toHaveBeenLastCalledWith({position: 7, duration: 30});
    expect(f.state).toHaveBeenLastCalledWith("playing");
    f.listeners.playback_update({data: {isPaused: false, position: 29_800, duration: 30_000}});
    session.pause(); session.play();
    expect(f.controller.restart).toHaveBeenCalledOnce();
    expect(f.controller.resume).not.toHaveBeenCalled();
    session.restart();
    expect(f.controller.restart).toHaveBeenCalledTimes(2);
    expect(f.state).toHaveBeenLastCalledWith("starting");
    session.dispose();
  });
  it("times out a replay even if a stale paused event arrives", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api});
    await Promise.resolve(); f.listeners.ready({}); session.play();
    f.listeners.playback_update({data: {isPaused: false, position: 200}});
    session.pause(); session.play();
    f.listeners.playback_update({data: {isPaused: true, position: 200}});
    vi.advanceTimersByTime(12_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    session.dispose();
  });
  it("keeps the host pause until Spotify acknowledges it, then allows player controls", async () => {
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, { load: async () => f.api });
    await Promise.resolve(); f.listeners.ready({}); session.play();
    f.listeners.playback_update({ data: { isPaused: false, position: 200 } });
    session.pause();
    f.listeners.playback_update({ data: { isPaused: false, position: 300 } });
    expect(f.state).toHaveBeenLastCalledWith("paused");
    f.listeners.playback_update({ data: { isPaused: true, position: 300 } });
    f.listeners.playback_update({ data: { isPaused: false, position: 400 } });
    expect(f.state).toHaveBeenLastCalledWith("playing");
    session.dispose();
  });
  it("stops playback on provider errors and tears down even if provider methods throw", async () => {
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api});
    await Promise.resolve(); f.listeners.error({});
    expect(f.controller.pause).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("error");
    vi.mocked(f.controller.pause).mockImplementation(() => { throw Error(); });
    vi.mocked(f.controller.destroy).mockImplementation(() => { throw Error(); });
    expect(() => session.dispose()).not.toThrow();
    expect(f.host.children).toHaveLength(0);
    const count = f.state.mock.calls.length;
    f.listeners.ready({});
    expect(f.state).toHaveBeenCalledTimes(count);
  });
  it("does not create a controller after its view is disposed", async () => {
    const f = fixture(); let resolve!: (api: SpotifyEmbedAPI) => void;
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: () => new Promise(r => { resolve = r; })});
    session.dispose(); resolve(f.api); await Promise.resolve();
    expect(f.api.createController).not.toHaveBeenCalled();
  });
  it("destroys a controller delivered after its view is disposed", async () => {
    const f = fixture(); let created!: (controller: SpotifyEmbedController) => void;
    f.api.createController = (_element, _options, callback) => { created = callback; };
    const session = new SpotifyPreviewSession(f.host, "track", f.state, {load: async () => f.api});
    await Promise.resolve(); session.dispose(); created(f.controller);
    expect(f.controller.destroy).toHaveBeenCalledOnce();
  });
});

it("routes commands and state through only this preview frame, then removes it", async () => {
  const f = fixture();
  const session = new SpotifyPreviewSession(f.host, "0123456789ABCDEFGHIJKL", f.state);
  await Promise.resolve();
  const frame = f.host.querySelector("iframe")!;
  expect(new URL(frame.src).pathname).toBe("/spotify-preview.html");
  const receive = (source: Window, origin: string) => window.dispatchEvent(new MessageEvent("message", {
    source, origin, data: {channel: "eratic-preview", name: "ready"},
  }));
  receive(window, location.origin);
  receive(frame.contentWindow!, "https://example.com");
  expect(f.state).toHaveBeenLastCalledWith("loading");
  receive(frame.contentWindow!, location.origin);
  expect(f.state).toHaveBeenLastCalledWith("ready");
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  session.play();
  expect(post).toHaveBeenCalledWith({channel: "eratic-preview", command: "play"}, location.origin);
  session.seek(12);
  expect(post).toHaveBeenCalledWith({channel: "eratic-preview", command: "seek", seconds: 12}, location.origin);
  session.dispose();
  expect(f.host.querySelector("iframe")).toBeNull();
});

describe("Apple hidden preview", () => {
  const preview = "https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a";
  const reply = (results: unknown[], ok = true) => vi.fn(async (_input: unknown, _init?: unknown) => ({ ok, json: async () => ({ results }) }) as Response) as unknown as typeof fetch;
  const track = (extra: object = {}) => ({ wrapperType: "track", trackId: 456, trackName: "Secret", previewUrl: preview, ...extra });
  function audioFixture() {
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    audio.play = vi.fn(async () => {}); audio.pause = vi.fn(); audio.load = vi.fn();
    return audio;
  }
  async function start(results: unknown[], options: object = {}) {
    const state = vi.fn(); const audio = audioFixture();
    const fetchMock = reply(results);
    const session = new ApplePreviewSession("456", "us", state, { fetch: fetchMock, createAudio: () => audio, ...options });
    await new Promise(r => setTimeout(r, 0));
    return { state, audio, fetchMock, session };
  }
  it("looks up only the song's preview and stays hidden", async () => {
    const f = await start([track()]);
    const [url, init] = vi.mocked(f.fetchMock).mock.calls[0] as [string, { signal: AbortSignal }];
    const lookup = new URL(url);
    expect(lookup.origin + lookup.pathname).toBe("https://itunes.apple.com/lookup");
    expect(Object.fromEntries(lookup.searchParams)).toEqual({ id: "456", country: "us", entity: "song" });
    expect(init.signal.aborted).toBe(false);
    expect(f.audio.src).toBe(preview);
    expect(f.audio.parentElement).toBeNull();
    f.session.dispose();
  });
  it("reports unavailable for a wrong track, insecure URL or foreign host", async () => {
    for (const results of [[track({ trackId: 1 })], [track({ previewUrl: "http://audio-ssl.itunes.apple.com/x.m4a" })],
      [track({ previewUrl: "https://evilapple.com/x.m4a" })], [track({ previewUrl: "https://apple.com.evil.test/x.m4a" })],
      [track({ wrapperType: "collection" })], [track({ previewUrl: undefined })]]) {
      const f = await start(results);
      expect(f.state).toHaveBeenLastCalledWith("unavailable");
      f.session.dispose();
    }
  });
  it("reports error when the lookup fails", async () => {
    const state = vi.fn();
    const session = new ApplePreviewSession("456", "us", state, { fetch: vi.fn(async () => { throw Error("offline"); }) as unknown as typeof fetch });
    await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith("error"));
    const bad = new ApplePreviewSession("456", "us", state, { fetch: reply([], false) });
    await vi.waitFor(() => expect(state.mock.calls.filter(c => c[0] === "error")).toHaveLength(2));
    session.dispose(); bad.dispose();
  });
  it("maps audio events to states and progress, autoplays, and rewinds at the end", async () => {
    const progress = vi.fn();
    const f = await start([track()], { autoplay: true, progress });
    f.audio.dispatchEvent(new Event("canplay"));
    expect(f.state).toHaveBeenCalledWith("ready");
    expect(f.audio.play).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("starting");
    f.audio.dispatchEvent(new Event("playing")); expect(f.state).toHaveBeenLastCalledWith("playing");
    f.audio.dispatchEvent(new Event("waiting")); expect(f.state).toHaveBeenLastCalledWith("starting");
    f.audio.currentTime = 4; f.audio.dispatchEvent(new Event("timeupdate"));
    expect(progress).toHaveBeenLastCalledWith({ position: 4, duration: 30 });
    f.audio.dispatchEvent(new Event("pause")); expect(f.state).toHaveBeenLastCalledWith("paused");
    f.audio.dispatchEvent(new Event("ended")); expect(f.state).toHaveBeenLastCalledWith("paused");
    f.audio.currentTime = 29.8; f.session.play();
    expect(f.audio.currentTime).toBe(0);
    f.session.seek(99); expect(f.audio.currentTime).toBe(30);
    f.session.seek(-1); expect(f.audio.currentTime).toBe(0);
    f.audio.currentTime = 20; f.session.restart();
    expect(f.audio.currentTime).toBe(0);
    expect(f.audio.play).toHaveBeenCalledTimes(3);
    f.audio.dispatchEvent(new Event("error")); expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
  });
  it("treats a pause during startup as a pause and blocked autoplay as ready", async () => {
    const f = await start([track()]);
    f.audio.dispatchEvent(new Event("canplay"));
    const reject = (name: string) => { f.audio.play = vi.fn(async () => { throw Object.assign(Error(name), { name }); }); };
    reject("AbortError"); f.session.play(); f.audio.dispatchEvent(new Event("pause"));
    await new Promise(r => setTimeout(r, 0));
    expect(f.state).toHaveBeenLastCalledWith("paused");
    reject("NotAllowedError"); f.session.play();
    await new Promise(r => setTimeout(r, 0));
    expect(f.state).toHaveBeenLastCalledWith("ready");
    reject("NotSupportedError"); f.session.play();
    await new Promise(r => setTimeout(r, 0));
    expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
  });
  it("times out a stall during playback", async () => {
    const f = await start([track()]);
    vi.useFakeTimers();
    f.audio.dispatchEvent(new Event("canplay")); f.session.play();
    f.audio.dispatchEvent(new Event("playing")); f.audio.dispatchEvent(new Event("waiting"));
    vi.advanceTimersByTime(12_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
  });
  it("keeps a stall failure terminal when pause and other media events arrive late", async () => {
    const f = await start([track()], { autoplay: true });
    vi.useFakeTimers();
    f.audio.pause = vi.fn(() => { setTimeout(() => f.audio.dispatchEvent(new Event("pause")), 0); });
    f.audio.dispatchEvent(new Event("canplay"));
    f.audio.dispatchEvent(new Event("playing"));
    f.audio.dispatchEvent(new Event("waiting"));
    await vi.advanceTimersByTimeAsync(12_001);
    for (const name of ["pause", "ended", "playing", "canplay"]) f.audio.dispatchEvent(new Event(name));
    expect(f.state).toHaveBeenLastCalledWith("error");
    expect(f.audio.hasAttribute("src")).toBe(false);
    f.session.play(); f.session.restart();
    expect(f.audio.play).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("does not extend a stall deadline on repeated waiting, but cancels it for host pause", async () => {
    const f = await start([track()]);
    vi.useFakeTimers();
    f.audio.dispatchEvent(new Event("canplay")); f.session.play();
    await vi.advanceTimersByTimeAsync(6_000);
    f.audio.dispatchEvent(new Event("waiting"));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
    vi.useRealTimers();
    const paused = await start([track()]);
    vi.useFakeTimers();
    paused.audio.dispatchEvent(new Event("canplay")); paused.session.play();
    paused.session.pause();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(paused.state).toHaveBeenLastCalledWith("paused");
    paused.session.dispose();
  });
  it("keeps the new start deadline when an earlier pause event arrives after resume", async () => {
    const f = await start([track()]);
    vi.useFakeTimers();
    f.audio.dispatchEvent(new Event("canplay")); f.session.play();
    f.session.pause(); f.session.play();
    Object.defineProperty(f.audio, "paused", { value: false, configurable: true });
    f.audio.dispatchEvent(new Event("pause"));
    expect(f.state).toHaveBeenLastCalledWith("starting");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
  });
  it("ignores an earlier play rejection after a newer play request", async () => {
    const f = await start([track()]);
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    f.audio.play = vi.fn().mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; }))
      .mockResolvedValue(undefined);
    f.audio.dispatchEvent(new Event("canplay")); f.session.play();
    f.session.pause(); f.session.play();
    reject(Object.assign(Error(), { name: "NotAllowedError" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state).toHaveBeenLastCalledWith("starting");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    f.session.dispose();
  });
  it("aborts an expired lookup and ignores its response even if cancellation loses the race", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const state = vi.fn(); const createAudio = vi.fn(audioFixture);
    const session = new ApplePreviewSession("456", "us", state, {
      fetch: fetchMock as unknown as typeof fetch, createAudio, autoplay: true,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    const signal = (fetchMock.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(true);
    resolve({ ok: true, json: async () => ({ results: [track()] }) } as Response);
    await vi.advanceTimersByTimeAsync(0);
    expect(createAudio).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith("error");
    session.dispose();
  });
  it("unloads a media load that expires and never autoplays a late canplay event", async () => {
    vi.useFakeTimers();
    const audio = audioFixture(); const state = vi.fn();
    const session = new ApplePreviewSession("456", "us", state, {
      fetch: reply([track()]), createAudio: () => audio, autoplay: true,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(state).toHaveBeenLastCalledWith("error");
    audio.dispatchEvent(new Event("canplay"));
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.hasAttribute("src")).toBe(false);
    session.dispose();
  });
  it("aborts the lookup, pauses and ignores late events after dispose", async () => {
    const f = await start([track()]);
    const signal = (vi.mocked(f.fetchMock).mock.calls[0][1] as { signal: AbortSignal }).signal;
    f.session.dispose();
    expect(signal.aborted).toBe(true);
    expect(f.audio.pause).toHaveBeenCalled();
    expect(f.audio.load).toHaveBeenCalled();
    expect(f.audio.hasAttribute("src")).toBe(false);
    const count = f.state.mock.calls.length;
    f.audio.dispatchEvent(new Event("pause")); f.audio.dispatchEvent(new Event("playing"));
    expect(f.state).toHaveBeenCalledTimes(count);
  });
});

describe("Spotify snippets", () => {
  async function ready() {
    vi.useFakeTimers();
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, { load: async () => f.api });
    await vi.advanceTimersByTimeAsync(0); f.listeners.ready({});
    const update = (data: object) => f.listeners.playback_update({ data });
    return { ...f, session, update };
  }
  it("times from the first audible progress, calls onAudible once and pauses at the length", async () => {
    const f = await ready();
    const audible = vi.fn();
    f.session.snippet(0, 1000, audible);
    expect(f.controller.play).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("starting");
    await vi.advanceTimersByTimeAsync(3000);
    f.update({ isPaused: false, isBuffering: true, position: 0 });
    f.update({ isPaused: false, isBuffering: false, position: 0 });
    expect(audible).not.toHaveBeenCalled();
    f.update({ isPaused: false, position: 100 });
    expect(audible).toHaveBeenCalledOnce();
    f.update({ isPaused: false, position: 400 });
    expect(audible).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(899);
    expect(f.controller.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.controller.pause).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("paused");
    f.session.dispose();
  });
  it("stops early when a progress report passes the length", async () => {
    const f = await ready();
    f.session.snippet(0, 1000, vi.fn());
    f.update({ isPaused: false, position: 100 });
    f.update({ isPaused: false, position: 1050 });
    expect(f.controller.pause).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("replays in the same controller and seeks for a later start", async () => {
    const f = await ready();
    f.session.snippet(0, 1000, vi.fn());
    f.update({ isPaused: false, position: 100 });
    await vi.advanceTimersByTimeAsync(900);
    f.update({ isPaused: true, position: 1000 });
    f.session.snippet(0, 5000, vi.fn());
    expect(f.controller.restart).toHaveBeenCalledOnce();
    f.update({ isPaused: false, position: 50 });
    f.session.snippet(2, 1000, vi.fn());
    expect(f.controller.seek).toHaveBeenCalledWith(2);
    expect(f.controller.resume).toHaveBeenCalledOnce();
    expect(f.api.createController).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("ignores stale positions when replayed mid-snippet, and gives up on them after 1.5 s", async () => {
    const f = await ready();
    f.session.snippet(0, 5000, vi.fn());
    f.update({ isPaused: false, position: 100 });
    await vi.advanceTimersByTimeAsync(3400);
    f.update({ isPaused: false, position: 3500 });
    const audible = vi.fn();
    f.session.snippet(0, 1000, audible);
    f.update({ isPaused: false, position: 3600 });
    f.update({ isPaused: false, position: 3700 });
    expect(audible).not.toHaveBeenCalled();
    expect(f.controller.pause).not.toHaveBeenCalled();
    f.update({ isPaused: false, position: 100 });
    expect(audible).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(899);
    expect(f.controller.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.controller.pause).toHaveBeenCalledOnce();
    // Reports that never drop below the old position stop counting as stale after 1.5 s.
    f.update({ isPaused: false, position: 4000 });
    const late = vi.fn();
    f.session.snippet(0, 30_000, late);
    f.update({ isPaused: false, position: 4200 });
    expect(late).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    f.update({ isPaused: false, position: 4700 });
    expect(late).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("ignores stale positions from before a replay's rewind", async () => {
    const f = await ready();
    f.session.snippet(0, 1000, vi.fn());
    f.update({ isPaused: false, position: 100 });
    await vi.advanceTimersByTimeAsync(900);
    // Replay before Spotify acknowledged the stop: queued playing snapshots still arrive.
    f.update({ isPaused: false, position: 1100 });
    const audible = vi.fn();
    f.session.snippet(0, 1000, audible);
    f.update({ isPaused: false, position: 1200 });
    f.update({ isPaused: false, position: 1300 });
    expect(audible).not.toHaveBeenCalled();
    expect(f.controller.pause).toHaveBeenCalledOnce();
    f.update({ isPaused: false, position: 80 });
    expect(audible).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(919);
    expect(f.controller.pause).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.controller.pause).toHaveBeenCalledTimes(2);
    f.session.dispose();
  });
  it("a host pause, a new request, dispose or an ended preview cancels the snippet", async () => {
    const f = await ready();
    const first = vi.fn();
    f.session.snippet(0, 1000, first);
    f.session.pause();
    f.update({ isPaused: true, position: 0 });
    f.update({ isPaused: false, position: 100 });
    expect(first).not.toHaveBeenCalled();
    const second = vi.fn(); const third = vi.fn();
    f.session.snippet(0, 1000, second);
    f.session.snippet(0, 1000, third);
    f.update({ isPaused: false, position: 100 });
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledOnce();
    vi.mocked(f.controller.pause).mockClear();
    f.session.play();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.controller.pause).not.toHaveBeenCalled();
    const fourth = vi.fn();
    f.session.snippet(0, 1000, fourth);
    f.session.dispose();
    f.update({ isPaused: false, position: 100 });
    expect(fourth).not.toHaveBeenCalled();
    vi.mocked(f.controller.pause).mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.controller.pause).not.toHaveBeenCalled();
  });
  it("ends quietly when the preview ends first, and errors if it never starts", async () => {
    const f = await ready();
    f.session.snippet(0, 5000, vi.fn());
    f.update({ isPaused: false, position: 100 });
    f.update({ isPaused: true, position: 3000 });
    vi.mocked(f.controller.pause).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.controller.pause).not.toHaveBeenCalled();
    const audible = vi.fn();
    f.session.snippet(0, 1000, audible);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.state).toHaveBeenLastCalledWith("error");
    expect(audible).not.toHaveBeenCalled();
  });
});

describe("Apple snippets", () => {
  const preview = "https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a";
  async function ready() {
    vi.useFakeTimers();
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { value: 30, configurable: true });
    Object.defineProperty(audio, "paused", { value: false, configurable: true });
    audio.play = vi.fn(async () => {}); audio.pause = vi.fn(); audio.load = vi.fn();
    const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) =>
      ({ ok: true, json: async () => ({ results: [{ wrapperType: "track", trackId: 456, previewUrl: preview }] }) }) as Response) as unknown as typeof fetch;
    const state = vi.fn();
    const session = new ApplePreviewSession("456", "us", state, { fetch: fetchMock, createAudio: () => audio });
    await vi.advanceTimersByTimeAsync(0);
    audio.dispatchEvent(new Event("canplay"));
    return { audio, state, session, fetchMock };
  }
  it("treats progress as the onset when a replay of a playing preview fires no playing event", async () => {
    const f = await ready();
    let time = 0;
    Object.defineProperty(f.audio, "currentTime", { get: () => time, set: (value: number) => { time = value; }, configurable: true });
    f.session.snippet(0, 30_000, vi.fn());
    f.audio.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(3000);
    time = 3; f.audio.dispatchEvent(new Event("timeupdate"));
    const audible = vi.fn();
    f.session.snippet(0, 15_000, audible);
    expect(f.state).toHaveBeenLastCalledWith("starting");
    time = 0.3; f.audio.dispatchEvent(new Event("timeupdate"));
    expect(audible).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("playing");
    await vi.advanceTimersByTimeAsync(14_000);
    expect(f.state).not.toHaveBeenCalledWith("error");
    expect(f.audio.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(f.audio.pause).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("times from the playing event, calls onAudible once and pauses at the length", async () => {
    const f = await ready();
    const audible = vi.fn();
    f.session.snippet(0, 1000, audible);
    expect(f.audio.currentTime).toBe(0);
    expect(f.audio.play).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(audible).not.toHaveBeenCalled();
    f.audio.dispatchEvent(new Event("playing"));
    f.audio.dispatchEvent(new Event("timeupdate"));
    expect(audible).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.audio.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.audio.pause).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenLastCalledWith("paused");
    f.session.dispose();
  });
  it("stops early by position and replays on the same audio element", async () => {
    const f = await ready();
    f.session.snippet(0, 1000, vi.fn());
    f.audio.dispatchEvent(new Event("playing"));
    f.audio.currentTime = 1.05;
    f.audio.dispatchEvent(new Event("timeupdate"));
    expect(f.audio.pause).toHaveBeenCalledOnce();
    f.session.snippet(0, 5000, vi.fn());
    expect(f.audio.currentTime).toBe(0);
    expect(f.audio.play).toHaveBeenCalledTimes(2);
    expect(f.fetchMock).toHaveBeenCalledOnce();
    f.session.dispose();
  });
  it("a host pause, a new request or dispose cancels the snippet", async () => {
    const f = await ready();
    const first = vi.fn();
    f.session.snippet(0, 1000, first);
    f.session.pause();
    f.audio.dispatchEvent(new Event("playing"));
    expect(first).not.toHaveBeenCalled();
    const second = vi.fn(); const third = vi.fn();
    f.session.snippet(0, 1000, second);
    f.session.snippet(0, 1000, third);
    f.audio.dispatchEvent(new Event("playing"));
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledOnce();
    const fourth = vi.fn();
    f.session.snippet(0, 1000, fourth);
    f.session.dispose();
    f.audio.dispatchEvent(new Event("playing"));
    expect(fourth).not.toHaveBeenCalled();
  });
  it("ends quietly when the preview ends first", async () => {
    const f = await ready();
    f.session.snippet(0, 5000, vi.fn());
    f.audio.dispatchEvent(new Event("playing"));
    f.audio.dispatchEvent(new Event("ended"));
    vi.mocked(f.audio.pause).mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.audio.pause).not.toHaveBeenCalled();
    f.session.dispose();
  });
});
