import { describe, expect, it } from "vitest";
import {
  CALIBRATION_KEY,
  loadCalibration,
  runCalibration,
  saveCalibration,
  summarise,
} from "./calibration";
import type { Player } from "./player";
import { FakeClock, memoryStorage } from "./testing";

const trial = (latencyMs: number, stopErrorMs: number | undefined) => ({ latencyMs, stopErrorMs });

describe("summarise", () => {
  it("takes the median latency of odd and even counts", () => {
    expect(summarise([trial(300, 0), trial(100, 0), trial(200, 0)]).medianLatencyMs).toBe(200);
    expect(summarise([trial(100, 0), trial(200, 0), trial(400, 0), trial(300, 0)]).medianLatencyMs).toBe(250);
  });
  it("passes at exactly 150 ms and fails above, in either direction", () => {
    expect(summarise([trial(0, 150), trial(0, -150)]).passed).toBe(true);
    expect(summarise([trial(0, 150), trial(0, 151)]).passed).toBe(false);
    expect(summarise([trial(0, -151)]).passed).toBe(false);
    expect(summarise([trial(0, -151), trial(0, 10)]).maxStopErrorMs).toBe(151);
  });
  it("does not pass when positions could not be read", () => {
    expect(summarise([trial(0, undefined)]).passed).toBe(false);
    expect(summarise([]).passed).toBe(false);
  });
});

describe("runCalibration", () => {
  it("plays 1 s clips from 30 s and measures latency and stop error", async () => {
    const clock = new FakeClock();
    const played: number[] = [];
    let position = 0;
    const player: Player = {
      provider: "manual",
      tier: () => ({ kind: "fullTrack" }),
      connect: async () => {},
      prepare: async () => {},
      async play(fromMs) {
        played.push(fromMs);
        const requestedAt = clock.now();
        await clock.sleep(200);
        return { requestedAt, audibleAt: clock.now(), positionMs: fromMs };
      },
      async stop() {
        position = 31_080; // overshoots by 80 ms
      },
      positionMs: async () => position,
    };
    const run = runCalibration(player, { provider: "manual", id: "t" }, clock, 3);
    await clock.advance(10_000);
    const result = await run;
    expect(played).toEqual([30_000, 30_000, 30_000]);
    expect(result.trials).toHaveLength(3);
    expect(result.medianLatencyMs).toBe(200);
    expect(result.maxStopErrorMs).toBe(80);
    expect(result.passed).toBe(true);
  });
});

describe("calibration storage", () => {
  const result = summarise([trial(100, 20)], 1);
  it("round-trips per provider", () => {
    const storage = memoryStorage();
    saveCalibration("spotify", result, storage);
    saveCalibration("appleMusic", { ...result, medianLatencyMs: 5 }, storage);
    expect(loadCalibration("spotify", storage)).toEqual(result);
    expect(loadCalibration("appleMusic", storage)?.medianLatencyMs).toBe(5);
    expect(loadCalibration("manual", storage)).toBeUndefined();
  });
  it("treats corrupt data as absent and overwrites it on save", () => {
    const storage = memoryStorage();
    for (const bad of ["{nope", "null", "[]", '{"spotify":{"trials":1}}'])  {
      storage.setItem(CALIBRATION_KEY, bad);
      expect(loadCalibration("spotify", storage)).toBeUndefined();
    }
    saveCalibration("spotify", result, storage);
    expect(loadCalibration("spotify", storage)).toEqual(result);
  });
  it("never throws when storage is broken or missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    } as unknown as Storage;
    expect(() => saveCalibration("spotify", result, broken)).not.toThrow();
    expect(loadCalibration("spotify", broken)).toBeUndefined();
    expect(() => saveCalibration("spotify", result, undefined)).not.toThrow();
  });
});
