import { systemClock, type Clock } from "./clock";
import {
  PlaybackError,
  type AudibleStart,
  type PlayableTrack,
  type PlaybackTier,
  type Player,
} from "./player";

// "Play it yourself": opens the card's link and cannot time anything.
export class ManualPlayer implements Player {
  readonly provider = "manual" as const;
  private track?: PlayableTrack;

  constructor(
    private clock: Clock = systemClock,
    private open: (url: string) => void = (url) => {
      window.open(url, "_blank", "noopener");
    },
  ) {}

  tier(): PlaybackTier {
    return { kind: "noExactPlayback" };
  }
  async connect(): Promise<void> {}
  async prepare(track: PlayableTrack): Promise<void> {
    this.track = track;
  }
  async play(fromMs: number): Promise<AudibleStart> {
    const requestedAt = this.clock.now();
    if (!this.track?.url)
      throw new PlaybackError("trackUnavailable", "This card has no link to open.");
    this.open(this.track.url);
    return { requestedAt, audibleAt: requestedAt, positionMs: fromMs };
  }
  async stop(): Promise<void> {}
  async positionMs(): Promise<number | undefined> {
    return undefined;
  }
}
