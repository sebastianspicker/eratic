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
    eraticPreview: { play(): void; pause(): void; restart(): void; dispose(): void; snippet(from: number, ms: number): void };
  };
  runInNewContext(script, { window, document: { getElementById: () => ({}) }, setTimeout, clearTimeout });
  const connect = () => { window.onSpotifyIframeApiReady(api); deliver(controller); };
  const update = (data: object) => listeners.playback_update({ data });
  const state = () => post.mock.calls.map(([value]) => value).filter(value => typeof value === "string").at(-1);
  const audible = () => post.mock.calls.filter(([value]) => typeof value === "object" && value?.snippet === "audible").length;
  return { window, controller, api, listeners, connect, update, state, audible, deliver: () => deliver(controller) };
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

it("native Spotify retries a silent autoplay once, then offers Play instead of starting forever", () => {
  const f = fixture(); f.connect(); f.listeners.ready({});
  expect(f.controller.play).toHaveBeenCalledOnce();
  expect(f.state()).toBe("starting");
  vi.advanceTimersByTime(2_000);
  expect(f.controller.play).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(4_000);
  expect(f.state()).toBe("ready");
  vi.advanceTimersByTime(12_000);
  expect(f.state()).toBe("ready");
  f.window.eraticPreview.play();
  expect(f.controller.play).toHaveBeenCalledTimes(3);
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  expect(f.state()).toBe("playing");
  f.window.eraticPreview.dispose();
});

it("native Spotify keeps an accepted autoplay that is still buffering", () => {
  const f = fixture(); f.connect(); f.listeners.ready({});
  f.update({ isPaused: false, isBuffering: true, position: 0, duration: 30_000 });
  vi.advanceTimersByTime(6_000);
  expect(f.controller.play).toHaveBeenCalledOnce();
  expect(f.state()).toBe("starting");
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  expect(f.state()).toBe("playing");
  f.window.eraticPreview.dispose();
});

// A paused preview that has already played once, as after a first snippet or the host's pause.
function started() {
  const f = fixture(); f.connect(); f.listeners.ready({});
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  f.window.eraticPreview.pause();
  f.update({ isPaused: true, position: 100 });
  return f;
}

it("native Spotify snippet reports sound once and pauses itself after its length", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 1000);
  expect(f.controller.restart).toHaveBeenCalledOnce();
  expect(f.state()).toBe("starting");
  f.update({ isPaused: true, position: 100 });
  f.update({ isPaused: false, isBuffering: true, position: 0 });
  expect(f.audible()).toBe(0);
  f.update({ isPaused: false, position: 200, duration: 30_000 });
  expect(f.audible()).toBe(1);
  expect(f.state()).toBe("playing");
  f.update({ isPaused: false, position: 400 });
  expect(f.audible()).toBe(1);
  vi.advanceTimersByTime(799);
  expect(f.state()).toBe("playing");
  expect(f.controller.pause).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(f.state()).toBe("paused");
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  f.update({ isPaused: false, position: 1100 });
  f.update({ isPaused: true, position: 1100 });
  expect(f.state()).toBe("paused");
  // A replay restarts the same controller and reports sound again.
  f.window.eraticPreview.snippet(0, 5000);
  expect(f.controller.restart).toHaveBeenCalledTimes(2);
  f.update({ isPaused: false, position: 150 });
  expect(f.audible()).toBe(2);
  f.window.eraticPreview.dispose();
});

it("native Spotify snippet pauses early when a report is already past its length", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 1000);
  f.update({ isPaused: false, position: 200 });
  f.update({ isPaused: false, position: 1050 });
  expect(f.state()).toBe("paused");
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5_000);
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  expect(f.audible()).toBe(1);
});

it("native Spotify snippet starts from a later position with resume and seek", () => {
  const f = started();
  f.window.eraticPreview.snippet(5, 1000);
  expect(f.controller.resume).toHaveBeenCalledOnce();
  expect(f.controller.seek).toHaveBeenCalledWith(5);
  expect(f.controller.restart).not.toHaveBeenCalled();
  f.update({ isPaused: false, position: 3000 });
  expect(f.audible()).toBe(0);
  f.update({ isPaused: false, position: 5100 });
  expect(f.audible()).toBe(1);
  vi.advanceTimersByTime(1_000);
  expect(f.state()).toBe("paused");
});

it("native Spotify snippet is cancelled by pause, play, restart, seek, a new snippet and disposal", () => {
  for (const cancel of ["pause", "play", "restart", "seek", "snippet", "dispose"] as const) {
    const f = started();
    f.window.eraticPreview.snippet(0, 1000);
    f.update({ isPaused: false, position: 200 });
    expect(f.audible()).toBe(1);
    const pauses = f.controller.pause.mock.calls.length;
    if (cancel === "seek") (f.window.eraticPreview as unknown as { seek(s: number): void }).seek(3);
    else if (cancel === "snippet") f.window.eraticPreview.snippet(0, 5000);
    else f.window.eraticPreview[cancel]();
    const after = f.controller.pause.mock.calls.length;
    vi.advanceTimersByTime(800);
    expect(f.controller.pause.mock.calls.length, cancel).toBe(after);
    expect(after - pauses, cancel).toBe(cancel === "pause" || cancel === "dispose" ? 1 : 0);
    f.window.eraticPreview.dispose();
  }
});

it("native Spotify snippet cancelled before sound never reports it", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 1000);
  f.window.eraticPreview.pause();
  f.update({ isPaused: false, position: 300 });
  expect(f.audible()).toBe(0);
  expect(f.state()).toBe("paused");
});

it("native Spotify snippet failure cancels it", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 1000);
  f.update({ isPaused: false, position: 200 });
  f.listeners.error({});
  expect(f.state()).toBe("error");
  const pauses = f.controller.pause.mock.calls.length;
  vi.advanceTimersByTime(2_000);
  expect(f.controller.pause.mock.calls.length).toBe(pauses);
});

it("native Spotify snippet ignores stale positions from before a replay's rewind", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 1000);
  f.update({ isPaused: false, position: 200, duration: 30_000 });
  f.update({ isPaused: false, position: 1050, duration: 30_000 });
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  // Replay before Spotify acknowledged the stop: queued playing snapshots still arrive.
  f.window.eraticPreview.snippet(0, 1000);
  f.update({ isPaused: false, position: 1100, duration: 30_000 });
  f.update({ isPaused: false, position: 1300, duration: 30_000 });
  expect(f.audible()).toBe(1);
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  f.update({ isPaused: false, position: 80, duration: 30_000 });
  expect(f.audible()).toBe(2);
  vi.advanceTimersByTime(919);
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(f.controller.pause).toHaveBeenCalledTimes(3);
  f.window.eraticPreview.dispose();
});

it("native Spotify snippet ignores stale positions when replayed mid-snippet", () => {
  const f = started();
  f.window.eraticPreview.snippet(0, 5000);
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  vi.advanceTimersByTime(3400);
  f.update({ isPaused: false, position: 3500, duration: 30_000 });
  f.window.eraticPreview.snippet(0, 1000);
  f.update({ isPaused: false, position: 3600, duration: 30_000 });
  expect(f.audible()).toBe(1);
  expect(f.controller.pause).toHaveBeenCalledTimes(1);
  f.update({ isPaused: false, position: 100, duration: 30_000 });
  expect(f.audible()).toBe(2);
  vi.advanceTimersByTime(899);
  expect(f.controller.pause).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(f.controller.pause).toHaveBeenCalledTimes(2);
  f.window.eraticPreview.dispose();
});

it("native Spotify cancels a snippet when the preview ends before its length", () => {
  const f = started();
  f.window.eraticPreview.snippet(27, 5000);
  f.update({ isPaused: false, position: 28_000, duration: 30_000 });
  expect(f.audible()).toBe(1);
  f.update({ isPaused: true, position: 30_000, duration: 30_000 });
  expect(f.state()).toBe("paused");
  vi.advanceTimersByTime(10_000);
  expect(f.controller.pause).toHaveBeenCalledTimes(1);
  f.window.eraticPreview.dispose();
});
