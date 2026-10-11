import { describe, expect, it } from "vitest";
import { ManualPlayer } from "./manualPlayer";
import { FakeClock } from "./testing";

describe("ManualPlayer", () => {
  it("has no exact playback and opens the card link at once", async () => {
    const opened: string[] = [];
    const clock = new FakeClock();
    clock.time = 42;
    const player = new ManualPlayer(clock, (url) => opened.push(url));
    expect(player.tier()).toEqual({ kind: "noExactPlayback" });
    await player.connect();
    await player.prepare({ provider: "manual", id: "x", url: "https://open.spotify.com/track/x" });
    const start = await player.play(5000);
    expect(opened).toEqual(["https://open.spotify.com/track/x"]);
    expect(start).toEqual({ requestedAt: 42, audibleAt: 42, positionMs: 5000 });
    expect(await player.positionMs()).toBeUndefined();
  });

  it("fails clearly when the card has no link", async () => {
    const player = new ManualPlayer(new FakeClock(), () => {});
    await player.prepare({ provider: "manual", id: "x" });
    await expect(player.play(0)).rejects.toMatchObject({ code: "trackUnavailable" });
  });
});
