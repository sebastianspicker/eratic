import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

// Execute the actual native bridge so its recovery behavior cannot drift behind
// the web session's tests. Only Swift's two string interpolations are substituted.
const swift = readFileSync(new URL("../../../apple/Sources/Playback/EmbeddedPreview.swift", import.meta.url), "utf8");
const script = swift.match(/<script>\s*([\s\S]*?)<\/script>/)![1]
  .replace(String.raw`\(autoplay ? "true" : "false")`, "true")
  .replace(String.raw`\(id)`, "0123456789ABCDEFGHIJKL");

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const post = vi.fn();
  const listeners: Record<string, (event: { data?: object }) => void> = {};
  const controller = {
    play: vi.fn(), pause: vi.fn(), resume: vi.fn(), restart: vi.fn(), seek: vi.fn(), destroy: vi.fn(),
    addListener: (name: string, handler: typeof listeners[string]) => { listeners[name] = handler; },
  };
  let deliver!: (value: typeof controller) => void;
  const api = { createController: vi.fn((_element, _options, callback) => { deliver = callback; }) };
  const window = {
    webkit: { messageHandlers: { preview: { postMessage: post } } },
  } as unknown as {
    onSpotifyIframeApiReady: (value: typeof api) => void;
    eraticPreview: { play(): void; pause(): void; restart(): void; dispose(): void };
  };
  runInNewContext(script, { window, document: { getElementById: () => ({}) }, setTimeout, clearTimeout });
  const connect = () => { window.onSpotifyIframeApiReady(api); deliver(controller); };
  const update = (data: object) => listeners.playback_update({ data });
  const state = () => post.mock.calls.map(([value]) => value).filter(value => typeof value === "string").at(-1);
  return { window, controller, api, listeners, connect, update, state, deliver: () => deliver(controller) };
}

it("native Spotify never autoplays readiness received after a load timeout", () => {
  const f = fixture(); f.connect();
  vi.advanceTimersByTime(12_000);
  expect(f.state()).toBe("error");
  f.listeners.ready({});
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  expect(f.controller.play).not.toHaveBeenCalled();
  expect(f.controller.destroy).toHaveBeenCalledOnce();
  expect(f.state()).toBe("error");
});

it("native Spotify rejects controllers and API callbacks delivered after expiry", () => {
  const f = fixture(); f.window.onSpotifyIframeApiReady(f.api);
  vi.advanceTimersByTime(12_000);
  f.deliver();
  expect(f.controller.destroy).toHaveBeenCalledOnce();
  f.window.onSpotifyIframeApiReady(f.api);
  expect(f.api.createController).toHaveBeenCalledOnce();
  expect(f.controller.play).not.toHaveBeenCalled();
});

it("native Spotify holds explicit pause through stale progress and repeated paused buffering", () => {
  const f = fixture(); f.connect(); f.listeners.ready({});
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  f.window.eraticPreview.pause();
  f.update({ isPaused: false, position: 200 });
  expect(f.state()).toBe("paused");
  f.update({ isPaused: true, isBuffering: true, position: 200 });
  f.update({ isPaused: true, isBuffering: true, position: 200 });
  vi.advanceTimersByTime(12_000);
  expect(f.state()).toBe("paused");
  f.window.eraticPreview.play();
  expect(f.controller.resume).toHaveBeenCalledOnce();
  f.update({ isPaused: false, position: 300 });
  expect(f.state()).toBe("playing");
  f.window.eraticPreview.dispose();
});

it("native Spotify does not extend a stalled playback deadline with repeated buffering", () => {
  const f = fixture(); f.connect(); f.listeners.ready({});
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  f.update({ isPaused: false, isBuffering: true, position: 100 });
  vi.advanceTimersByTime(6_000);
  f.update({ isPaused: false, isBuffering: true, position: 100 });
  vi.advanceTimersByTime(6_000);
  expect(f.state()).toBe("error");
  expect(f.controller.destroy).toHaveBeenCalledOnce();
});

it("native Spotify ignores events after disposal and bounds a replay despite stale pause", () => {
  const f = fixture(); f.connect(); f.listeners.ready({});
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  f.window.eraticPreview.pause(); f.window.eraticPreview.play();
  f.update({ isPaused: true, position: 100 });
  vi.advanceTimersByTime(12_000);
  expect(f.state()).toBe("error");
  f.window.eraticPreview.dispose(); f.listeners.ready({});
  f.update({ isPaused: false, position: 200 });
  expect(f.state()).toBe("error");
});
