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
