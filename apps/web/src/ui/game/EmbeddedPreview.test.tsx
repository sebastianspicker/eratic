// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmbeddedPreview } from "./EmbeddedPreview";

const fake = vi.hoisted(() => ({ created: vi.fn(), dispose: vi.fn(), play: vi.fn(), pause: vi.fn() }));
vi.mock("../../playback/embeddedPreview", async importOriginal => {
  const original = await importOriginal<typeof import("../../playback/embeddedPreview")>();
  return { ...original, SpotifyPreviewSession: class {
    constructor(_host: HTMLElement, id: string, notify: (s: string) => void) { fake.created(id); notify("ready"); }
    dispose = fake.dispose; play = fake.play; pause = fake.pause;
  } };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
const render = (url: string) => act(() => root.render(<EmbeddedPreview url={url} />));
const click = (text: string) => act(() => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text);
  expect(button, text).toBeDefined(); button!.click();
});
it("loads Spotify only on request, conceals metadata, and disposes when the card changes or leaves", async () => {
  await render("https://open.spotify.com/track/0123456789ABCDEFGHIJKL");
  expect(fake.created).not.toHaveBeenCalled();
  await click("Load preview");
  expect(fake.created).toHaveBeenCalledOnce();
  expect(host.querySelector('.embed-frame[aria-hidden="true"][inert]')).not.toBeNull();
  await click("Play preview"); expect(fake.play).toHaveBeenCalledOnce();
  await click("Show player (reveals song)");
  expect(host.querySelector('.embed-frame[aria-hidden="false"]')).not.toBeNull();
  await render("https://open.spotify.com/track/0000000000000000000000");
  expect(fake.dispose).toHaveBeenCalledOnce();
  await click("Load preview");
  await act(() => root.render(null));
  expect(fake.dispose).toHaveBeenCalledTimes(2);
});
it("Apple Hide retains audio while Stop unloads the player, and changing songs resets consent", async () => {
  await render("https://music.apple.com/us/song/example/123");
  expect(host.querySelector("iframe")).toBeNull();
  await click("Show Apple Music preview (reveals song)");
  const frame = host.querySelector("iframe");
  expect(frame?.src).toBe("https://embed.music.apple.com/us/song/example/123");
  await click("Hide player");
  expect(host.querySelector("iframe")).toBe(frame);
  expect(frame?.parentElement?.getAttribute("aria-hidden")).toBe("true");
  await click("Stop preview"); expect(host.querySelector("iframe")).toBeNull();
  await click("Show Apple Music preview (reveals song)");
  await render("https://music.apple.com/us/song/example/456");
  expect(host.querySelector("iframe")).toBeNull();
});
