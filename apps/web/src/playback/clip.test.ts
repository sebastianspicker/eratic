import { describe, expect, it } from "vitest";
import { ClipController, type ClipState } from "./clip";
import type { AudibleStart, Player } from "./player";
import { FakeClock } from "./testing";

// A player whose audio starts `latency` ms after the request and ends at `trackMs`.
function fakePlayer(clock: FakeClock, latency: number, trackMs = Infinity) {
  let startedAt: number | undefined;
  let stoppedAt: number | undefined;
  const player: Player & { stops: number } = {
    provider: "manual",
    stops: 0,
    tier: () => ({ kind: "fullTrack" }),
    connect: async () => {},
    prepare: async () => {},
    async play(fromMs): Promise<AudibleStart> {
      const requestedAt = clock.now();
      await clock.sleep(latency);
      startedAt = clock.now();
      stoppedAt = undefined;
      return { requestedAt, audibleAt: startedAt, positionMs: fromMs };
    },
    async stop() {
      this.stops++;
      stoppedAt = clock.now();
    },
    async positionMs() {
      if (startedAt === undefined) return undefined;
      return Math.min((stoppedAt ?? clock.now()) - startedAt, trackMs);
    },
  };
  return player;
}

function record(controller: ClipController) {
  const states: ClipState[] = [];
  controller.subscribe((s) => states.push(s));
  return states;
}

describe("ClipController", () => {
  it("counts the clip from the audible start, not the request", async () => {
    const clock = new FakeClock();
    const player = fakePlayer(clock, 400);
    const controller = new ClipController(clock);
    const states = record(controller);
    const done = controller.start(player, 0, 1000);
    await clock.advance(300);
    expect(states.at(-1)?.state).toBe("starting");
    await clock.advance(100); // audible at 400
    expect(states.at(-1)?.state).toBe("playing");
    await clock.advance(900); // t = 1300, still inside the clip
    expect(player.stops).toBe(0);
    await clock.advance(100); // t = 1400 = 400 + 1000
    await done;
    expect(player.stops).toBe(1);
    expect(states.at(-1)).toEqual({ state: "finished" });
    expect(states.some((s) => s.remainingMs !== undefined && s.remainingMs > 0)).toBe(true);
  });

  it("plays untimed clips until cancelled", async () => {
    const clock = new FakeClock();
    const player = fakePlayer(clock, 0);
    const controller = new ClipController(clock);
    const states = record(controller);
    void controller.start(player, 0, undefined);
    await clock.advance(20_000);
    expect(states.at(-1)).toEqual({ state: "playing" });
    expect(player.stops).toBe(0);
    await controller.cancel(player);
    expect(player.stops).toBe(1);
    expect(states.at(-1)).toEqual({ state: "idle" });
  });

  it("cancel during a timed clip stops it and never reports finished", async () => {
    const clock = new FakeClock();
    const player = fakePlayer(clock, 0);
    const controller = new ClipController(clock);
    const states = record(controller);
    void controller.start(player, 0, 5000);
    await clock.advance(1000);
    await controller.cancel(player);
    await clock.advance(10_000);
    expect(states.some((s) => s.state === "finished")).toBe(false);
    expect(player.stops).toBe(1);
  });

  it("finishes early when the track ends", async () => {
    const clock = new FakeClock();
    const player = fakePlayer(clock, 0, 2000);
    const controller = new ClipController(clock);
    const states = record(controller);
    const done = controller.start(player, 0, 10_000);
    await clock.advance(3500); // position froze at 2000; stall seen by about 3100
    await done;
    expect(states.at(-1)).toEqual({ state: "finished" });
    expect(clock.now()).toBe(3500);
    expect(player.stops).toBe(1);
  });

  it("returns to idle and rethrows when play fails", async () => {
    const clock = new FakeClock();
    const player = fakePlayer(clock, 0);
    player.play = async () => {
      throw new Error("nope");
    };
    const controller = new ClipController(clock);
    await expect(controller.start(player, 0, 1000)).rejects.toThrow("nope");
    expect(controller.state).toEqual({ state: "idle" });
  });
});
