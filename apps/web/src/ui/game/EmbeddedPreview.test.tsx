// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmbeddedPreview } from "./EmbeddedPreview";

const fake = vi.hoisted(() => ({
  created: vi.fn(), dispose: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), restart: vi.fn(),
  state: "ready", duration: 30, position: 12,
}));
vi.mock("../../playback/embeddedPreview", async importOriginal => {
  const original = await importOriginal<typeof import("../../playback/embeddedPreview")>();
  const methods = () => ({ dispose: fake.dispose, play: fake.play, pause: fake.pause, seek: fake.seek, restart: fake.restart });
  return { ...original,
    SpotifyPreviewSession: class {
      constructor(_host: HTMLElement, id: string, notify: (s: string) => void, options: { autoplay?: boolean; progress?: (p: object) => void }) {
        fake.created("spotify", id, options.autoplay); notify(fake.state);
        options.progress?.({ position: fake.position, duration: fake.duration });
      }
      dispose = fake.dispose; play = fake.play; pause = fake.pause; seek = fake.seek; restart = fake.restart;
    },
    ApplePreviewSession: class {
      constructor(id: string, storefront: string, notify: (s: string) => void, options: { autoplay?: boolean; progress?: (p: object) => void }) {
        fake.created("apple", id, storefront, options.autoplay); notify(fake.state);
        options.progress?.({ position: fake.position, duration: fake.duration });
      }
      dispose = methods().dispose; play = fake.play; pause = fake.pause; seek = fake.seek; restart = fake.restart;
    },
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(fake, { state: "ready", duration: 30, position: 12 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
const render = (url: string) => act(() => root.render(<EmbeddedPreview url={url} />));
const click = (text: string) => act(() => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text);
  expect(button, text).toBeDefined(); button!.click();
});
const spotify = "https://open.spotify.com/track/0123456789ABCDEFGHIJKL";
it("Spotify plays hidden from one button, offers transport, and disposes when the card changes or leaves", async () => {
  await render(spotify);
  expect(fake.created).not.toHaveBeenCalled();
  await click("Play preview");
  expect(fake.created).toHaveBeenCalledExactlyOnceWith("spotify", "0123456789ABCDEFGHIJKL", true);
  expect(host.querySelector('.embed-frame[aria-hidden="true"][inert]')).not.toBeNull();
  await click("Play"); expect(fake.play).toHaveBeenCalledOnce();
  await click("Back 10 s"); expect(fake.seek).toHaveBeenCalledWith(2);
  await click("Restart"); expect(fake.restart).toHaveBeenCalledOnce();
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Preview position"]')!;
  expect(slider.disabled).toBe(false); expect(slider.max).toBe("30"); expect(slider.value).toBe("12");
  expect(host.textContent).toContain("0:12 / 0:30");
  await click("Show player (reveals song)");
  expect(host.querySelector('.embed-frame[aria-hidden="false"]')).not.toBeNull();
  await render("https://open.spotify.com/track/0000000000000000000000");
  expect(fake.dispose).toHaveBeenCalledOnce();
  await click("Play preview");
  await act(() => root.render(null));
  expect(fake.dispose).toHaveBeenCalledTimes(2);
});
it("shows Pause while playing and the slider seeks", async () => {
  fake.state = "playing";
  await render(spotify); await click("Play preview");
  await click("Pause"); expect(fake.pause).toHaveBeenCalledOnce();
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Preview position"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(() => { set.call(slider, "20"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(fake.seek).not.toHaveBeenCalled();
  expect(slider.value).toBe("20");
  await act(() => { slider.dispatchEvent(new Event("pointerup", { bubbles: true })); });
  expect(fake.seek).toHaveBeenCalledExactlyOnceWith(20);
});
it("Spotify error offers retry that recreates the session", async () => {
  fake.state = "error";
  await render(spotify); await click("Play preview");
  await click("Retry preview");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(fake.dispose).toHaveBeenCalledOnce();
});
it("showing Spotify after a terminal error starts a fresh visible player", async () => {
  fake.state = "error";
  await render(spotify); await click("Play preview");
  fake.state = "ready";
  await click("Show player (reveals song)");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(fake.dispose).toHaveBeenCalledOnce();
  expect(host.querySelector('.embed-frame[aria-hidden="false"]')).not.toBeNull();
});
it("Apple plays hidden without revealing the embed, and resets when the song changes", async () => {
  await render("https://music.apple.com/us/song/example/123");
  await click("Play preview");
  expect(fake.created).toHaveBeenCalledExactlyOnceWith("apple", "123", "us", true);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).not.toContain("reveals song");
  await click("Restart"); expect(fake.restart).toHaveBeenCalledOnce();
  await render("https://music.apple.com/us/song/example/456");
  expect(fake.dispose).toHaveBeenCalledOnce();
  expect(host.querySelector("button")?.textContent).toBe("Play preview");
});
it("Apple falls back to the reveal flow when no hidden preview exists; Hide retains audio, Stop unloads", async () => {
  fake.state = "unavailable";
  await render("https://music.apple.com/us/song/example/123");
  await click("Play preview");
  expect(host.textContent).toContain("No hidden preview is available for this song.");
  expect(host.querySelector("iframe")).toBeNull();
  await click("Show Apple Music player (reveals song)");
  expect(fake.dispose).toHaveBeenCalledOnce();
  const frame = host.querySelector("iframe");
  expect(frame?.src).toBe("https://embed.music.apple.com/us/song/example/123");
  await click("Hide player");
  expect(host.querySelector("iframe")).toBe(frame);
  expect(frame?.parentElement?.getAttribute("aria-hidden")).toBe("true");
  await click("Stop preview"); expect(host.querySelector("iframe")).toBeNull();
});
it("Apple error offers retry and the reveal fallback", async () => {
  fake.state = "error";
  await render("https://music.apple.com/us/song/example/123");
  await click("Play preview");
  await click("Show Apple Music player (reveals song)");
  expect(fake.dispose).toHaveBeenCalledOnce();
  expect(host.querySelector("iframe")).not.toBeNull();
  fake.state = "ready";
  await click("Retry preview");
  expect(fake.created).toHaveBeenCalledTimes(2);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).not.toContain("Show Apple Music player (reveals song)");
});
