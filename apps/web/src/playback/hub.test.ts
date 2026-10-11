import { describe, expect, it } from "vitest";
import { PlaybackHub } from "./hub";
import { ManualPlayer } from "./manualPlayer";
import { PlaybackError, type Player } from "./player";
import { FakeClock } from "./testing";

const all = { spotify: true, appleMusic: false, manual: true };

describe("PlaybackHub", () => {
  it("lists only configured providers and creates nothing until asked", () => {
    let made = 0;
    const hub = new PlaybackHub(new FakeClock(), { manual: () => (made++, new ManualPlayer()) }, all);
    expect(hub.availableProviders()).toEqual(["spotify", "manual"]);
    expect(made).toBe(0);
  });

  it("connects, reports the tier and notifies subscribers", async () => {
    const hub = new PlaybackHub(new FakeClock(), {}, all);
    let notified = 0;
    hub.subscribe(() => notified++);
    await hub.connect("manual");
    expect(hub.state).toMatchObject({
      provider: "manual",
      tier: { kind: "noExactPlayback" },
      error: undefined,
      connecting: false,
    });
    expect(notified).toBeGreaterThan(0);
    expect(hub.player?.provider).toBe("manual");
  });

  it("says so when a provider is not configured", async () => {
    const hub = new PlaybackHub(new FakeClock(), {}, all);
    await hub.connect("appleMusic");
    expect(hub.state.provider).toBeUndefined();
    expect(hub.state.error).toMatch(/not set up/);
  });

  it("keeps the adapter's message when connecting fails", async () => {
    const failing = {
      provider: "spotify",
      tier: () => ({ kind: "unavailable", reason: "x" }),
      connect: async () => {
        throw new PlaybackError("notAuthorised", "Connect Spotify first.");
      },
    } as unknown as Player;
    const hub = new PlaybackHub(new FakeClock(), { spotify: () => failing }, all);
    await hub.connect("spotify");
    expect(hub.state.error).toBe("Connect Spotify first.");
    expect(hub.state.connecting).toBe(false);
  });
});
