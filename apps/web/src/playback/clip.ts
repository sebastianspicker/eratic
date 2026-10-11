import { systemClock, type Clock } from "./clock";
import type { AudibleStart, Player } from "./player";

export interface ClipState {
  state: "idle" | "starting" | "playing" | "finished";
  remainingMs?: number;
}
const TICK_MS = 100;
const STALL_MS = 1000;

// Plays one clip. The length counts from the audible start, never the request.
export class ClipController {
  private listeners = new Set<(state: ClipState) => void>();
  private run = 0;
  private current: ClipState = { state: "idle" };

  constructor(private clock: Clock = systemClock) {}

  get state(): ClipState {
    return this.current;
  }
  subscribe(listener: (state: ClipState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(state: ClipState) {
    this.current = state;
    for (const listener of [...this.listeners]) listener(state);
  }

  // onAudible runs once the audio is audible, unless the clip was cancelled first.
  async start(
    player: Player,
    fromMs: number,
    lengthMs: number | undefined,
    onAudible?: (start: AudibleStart) => void,
  ): Promise<void> {
    const run = ++this.run;
    this.emit({ state: "starting" });
    let started: AudibleStart;
    try {
      started = await player.play(fromMs);
    } catch (error) {
      if (run === this.run) this.emit({ state: "idle" });
      throw error;
    }
    if (run !== this.run) {
      await player.stop().catch(() => {});
      return;
    }
    const { audibleAt } = started;
    onAudible?.(started);
    const endAt = lengthMs === undefined ? undefined : audibleAt + lengthMs;
    let lastPosition: number | undefined;
    let lastMoved = this.clock.now();
    for (;;) {
      const now = this.clock.now();
      if (endAt !== undefined && now >= endAt) break;
      this.emit(
        endAt === undefined
          ? { state: "playing" }
          : { state: "playing", remainingMs: Math.max(0, endAt - now) },
      );
      await this.clock.sleep(
        endAt === undefined ? TICK_MS : Math.min(TICK_MS, Math.max(1, endAt - now)),
      );
      if (run !== this.run) return;
      const position = await player.positionMs().catch(() => undefined);
      if (run !== this.run) return;
      const at = this.clock.now();
      if (position !== undefined && position !== lastPosition) {
        lastPosition = position;
        lastMoved = at;
      } else if (
        lastPosition !== undefined &&
        at - lastMoved >= STALL_MS &&
        (endAt === undefined || endAt - at > 0)
      ) {
        break; // the track ended before the clip did
      }
    }
    await player.stop().catch(() => {});
    if (run === this.run) this.emit({ state: "finished" });
  }

  async cancel(player?: Player): Promise<void> {
    this.run++;
    this.emit({ state: "idle" });
    if (player) await player.stop().catch(() => {});
  }
}
