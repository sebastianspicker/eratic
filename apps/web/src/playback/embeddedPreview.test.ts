// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewTarget, SpotifyPreviewSession, type SpotifyEmbedAPI, type SpotifyEmbedController } from "./embeddedPreview";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function fixture() {
  const listeners: Record<string, (event: { data?: { isPaused?: boolean; isBuffering?: boolean; position?: number } }) => void> = {};
  const controller: SpotifyEmbedController = {
    play: vi.fn(), pause: vi.fn(), restart: vi.fn(), destroy: vi.fn(),
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
    expect(previewTarget("https://music.apple.com/us/album/example/123?i=456&at=tracking#frag")).toEqual({provider: "appleMusic", url: "https://embed.music.apple.com/us/album/example/123?i=456"});
    expect(previewTarget("https://music.apple.com/us/song/example/456")).toEqual({provider: "appleMusic", url: "https://embed.music.apple.com/us/song/example/456"});
  });
  it("does not embed arbitrary hosts, albums, or invalid ids", () => {
    for (const url of ["https://example.com/song", "https://music.apple.com/us/album/example/123", "https://open.spotify.com/track/no", "javascript:alert(1)"]) expect(previewTarget(url)).toBeUndefined();
  });
});

describe("Spotify preview lifecycle", () => {
  it("does not autoplay; distinguishes ready, buffering, actual progress and replay", async () => {
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, async () => f.api);
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
    expect(f.controller.restart).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("times out a replay even if a stale paused event arrives", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const session = new SpotifyPreviewSession(f.host, "track", f.state, async () => f.api);
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
    const session = new SpotifyPreviewSession(f.host, "track", f.state, async () => f.api);
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
    const session = new SpotifyPreviewSession(f.host, "track", f.state, () => new Promise(r => { resolve = r; }));
    session.dispose(); resolve(f.api); await Promise.resolve();
    expect(f.api.createController).not.toHaveBeenCalled();
  });
  it("destroys a controller delivered after its view is disposed", async () => {
    const f = fixture(); let created!: (controller: SpotifyEmbedController) => void;
    f.api.createController = (_element, _options, callback) => { created = callback; };
    const session = new SpotifyPreviewSession(f.host, "track", f.state, async () => f.api);
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
  session.dispose();
  expect(f.host.querySelector("iframe")).toBeNull();
});
