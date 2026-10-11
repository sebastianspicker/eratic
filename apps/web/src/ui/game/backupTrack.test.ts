import { describe, expect, it } from "vitest";
import type { Card } from "../../core/deck";
import { backupTrack } from "./playback";

const spotify = { provider: "spotify", url: "https://open.spotify.com/track/0123456789abcdefghijkl" } as const;
const apple = { provider: "appleMusic", url: "https://music.apple.com/us/album/example/123?i=456" } as const;
const other = { provider: "other", url: "https://example.com/music/1" } as const;
const card = (...links: Card["links"]): Card => ({ id: "c", title: "T", artist: "A", links }) as unknown as Card;

describe("backupTrack", () => {
  it("prefers the chosen provider's link, returned as a manual track", () => {
    const track = backupTrack(card(spotify, apple), "appleMusic");
    expect(track).toMatchObject({ provider: "manual", url: apple.url });
  });
  it("without a provider, or Play it yourself, takes the first link the preview recognises", () => {
    expect(backupTrack(card(other, apple, spotify), undefined)?.url).toBe(apple.url);
    expect(backupTrack(card(other, spotify), "manual")?.url).toBe(spotify.url);
    expect(backupTrack(card(other, spotify), "appleMusic")?.url).toBe(spotify.url);
  });
  it("falls back to the first link, or nothing", () => {
    expect(backupTrack(card(other), undefined)?.url).toBe(other.url);
    expect(backupTrack(card(), "spotify")).toBeUndefined();
  });
});
