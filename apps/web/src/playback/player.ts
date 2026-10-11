export type PlaybackProvider = "spotify" | "appleMusic" | "manual";
export type PlaybackTier =
  | { kind: "fullTrack" }
  | { kind: "previewOnly"; maxMs: number }
  | { kind: "noExactPlayback" }
  | { kind: "unavailable"; reason: string };
export interface PlayableTrack {
  provider: PlaybackProvider;
  id: string;
  storefront?: string;
  url?: string;
}
// Times are ms from the injected clock.
export interface AudibleStart {
  requestedAt: number;
  audibleAt: number;
  positionMs: number;
}
export interface Player {
  readonly provider: PlaybackProvider;
  tier(): PlaybackTier;
  connect(): Promise<void>; // authorise + detect tier
  prepare(track: PlayableTrack): Promise<void>;
  play(fromMs: number): Promise<AudibleStart>; // resolves once audio is audible
  stop(): Promise<void>;
  positionMs(): Promise<number | undefined>;
}
export const exactClips = (tier: PlaybackTier) =>
  tier.kind === "fullTrack" || tier.kind === "previewOnly";

export type PlaybackErrorCode =
  | "notConfigured"
  | "notAuthorised"
  | "noSubscription"
  | "trackUnavailable"
  | "noActiveDevice"
  | "network"
  | "timeout";
export class PlaybackError extends Error {
  constructor(
    readonly code: PlaybackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlaybackError";
  }
}
