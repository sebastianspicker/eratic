import type { Clock } from "./clock";
import type { PlayableTrack, PlaybackProvider, Player } from "./player";

export const CALIBRATION_KEY = "eratic.calibration.v1";
const CLIP_MS = 1000;
const FROM_MS = 30_000;
const PASS_MS = 150;

export interface CalibrationTrial {
  latencyMs: number;
  stopErrorMs: number | undefined;
}
export interface CalibrationResult {
  trials: CalibrationTrial[];
  medianLatencyMs: number;
  maxStopErrorMs: number;
  passed: boolean;
  at: number; // Date.now() when measured
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarise(trials: CalibrationTrial[], at = Date.now()): CalibrationResult {
  const errors = trials.flatMap((t) =>
    t.stopErrorMs === undefined ? [] : [Math.abs(t.stopErrorMs)],
  );
  const maxStopErrorMs = errors.length ? Math.max(...errors) : 0;
  return {
    trials,
    medianLatencyMs: median(trials.map((t) => t.latencyMs)),
    maxStopErrorMs,
    // Unmeasurable stops cannot pass: no position, no proof.
    passed: errors.length === trials.length && trials.length > 0 && maxStopErrorMs <= PASS_MS,
    at,
  };
}

export async function runCalibration(
  player: Player,
  track: PlayableTrack,
  clock: Clock,
  trials = 5,
): Promise<CalibrationResult> {
  await player.prepare(track);
  const results: CalibrationTrial[] = [];
  for (let i = 0; i < trials; i++) {
    const start = await player.play(FROM_MS);
    const wait = start.audibleAt + CLIP_MS - clock.now();
    if (wait > 0) await clock.sleep(wait);
    await player.stop();
    const position = await player.positionMs();
    results.push({
      latencyMs: start.audibleAt - start.requestedAt,
      stopErrorMs: position === undefined ? undefined : position - (FROM_MS + CLIP_MS),
    });
  }
  return summarise(results);
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function readAll(storage: Storage | undefined): Record<string, CalibrationResult> {
  try {
    const value = JSON.parse(storage?.getItem(CALIBRATION_KEY) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
export function saveCalibration(
  provider: PlaybackProvider,
  result: CalibrationResult,
  storage = defaultStorage(),
): void {
  try {
    storage?.setItem(
      CALIBRATION_KEY,
      JSON.stringify({ ...readAll(storage), [provider]: result }),
    );
  } catch {
    // storage full or blocked: the result is simply not remembered
  }
}
export function loadCalibration(
  provider: PlaybackProvider,
  storage = defaultStorage(),
): CalibrationResult | undefined {
  const value = readAll(storage)[provider] as Partial<CalibrationResult> | undefined;
  if (
    !value ||
    !Array.isArray(value.trials) ||
    typeof value.medianLatencyMs !== "number" ||
    typeof value.maxStopErrorMs !== "number" ||
    typeof value.passed !== "boolean"
  )
    return undefined;
  return value as CalibrationResult;
}
