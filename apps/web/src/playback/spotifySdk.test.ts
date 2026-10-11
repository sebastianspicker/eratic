// @vitest-environment jsdom
import { expect, it } from "vitest";
import { loadSpotifySdk } from "./spotifyPlayer";

it("shares one SDK load between concurrent callers", async () => {
  const first = loadSpotifySdk();
  const second = loadSpotifySdk();
  expect(second).toBe(first);
  expect(document.head.querySelectorAll('script[src="https://sdk.scdn.co/spotify-player.js"]')).toHaveLength(1);
  const sdk = { Player: class {} } as unknown as typeof Spotify;
  window.Spotify = sdk;
  window.onSpotifyWebPlaybackSDKReady?.();
  expect(await Promise.all([first, second])).toEqual([sdk, sdk]);
});
