import { systemClock, type Clock } from "./clock";
import {
  PlaybackError,
  type AudibleStart,
  type PlayableTrack,
  type PlaybackTier,
  type Player,
} from "./player";
import { loadScript } from "./scriptLoader";

const SDK_URL = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const POLL_MS = 50;
const AUDIBLE_TIMEOUT_MS = 10_000;
const PREVIEW_MS = 30_000;

export function appleMusicToken(): string | undefined {
  return import.meta.env.VITE_MUSICKIT_DEVELOPER_TOKEN || undefined;
}

export interface AppleMusicDeps {
  clock?: Clock;
  developerToken?: string;
  // Resolves once window.MusicKit exists; tests pass a fake.
  loadSdk?: () => Promise<typeof MusicKit>;
}

export function loadMusicKit(): Promise<typeof MusicKit> {
  return new Promise((resolve, reject) => {
    if (window.MusicKit) return resolve(window.MusicKit);
    // MusicKit announces itself with this document event once it is ready.
    document.addEventListener("musickitloaded", () => resolve(window.MusicKit!), {
      once: true,
    });
    loadScript(SDK_URL).catch(() =>
      reject(new PlaybackError("network", "Could not load Apple Music's player.")),
    );
  });
}

export class AppleMusicPlayer implements Player {
  readonly provider = "appleMusic" as const;
  private current: PlaybackTier;
  private music?: MusicKit.MusicKitInstance;
  private kit?: typeof MusicKit;
  private clock: Clock;
  private token?: string;
  private loadSdk: () => Promise<typeof MusicKit>;
  private songId?: string;
  private storefront?: string;

  constructor(deps: AppleMusicDeps = {}) {
    this.clock = deps.clock ?? systemClock;
    this.token = deps.developerToken ?? appleMusicToken();
    this.loadSdk = deps.loadSdk ?? loadMusicKit;
    this.current = {
      kind: "unavailable",
      reason: this.token ? "Not connected yet." : "Apple Music is not set up in this build.",
    };
  }

  tier(): PlaybackTier {
    return this.current;
  }

  async connect(authorize = false): Promise<void> {
    this.current = { kind: "noExactPlayback" };
    if (!this.token) return;
    this.kit = await this.loadSdk();
    try {
      this.music ??= await this.kit.configure({
        developerToken: this.token,
        app: { name: "Eratic", build: "0.1.0" },
      });
      if (!this.music.isAuthorized && authorize) await this.music.authorize();
    } catch {
      throw new PlaybackError("notAuthorised", "Apple Music sign-in did not complete.");
    }
    if (!this.music.isAuthorized) {
      if (authorize) throw new PlaybackError("notAuthorised", "Apple Music sign-in did not complete.");
      return;
    }
    // UNVERIFIED, needs a live check: a successful /v1/me/storefront call is
    // taken to mean an active subscription (full tracks); otherwise previews.
    try {
      await this.music.api.music("/v1/me/storefront");
      this.current = { kind: "fullTrack" };
    } catch {
      this.current = { kind: "previewOnly", maxMs: PREVIEW_MS };
    }
    this.storefront = this.music.storefrontId;
  }

  async prepare(track: PlayableTrack): Promise<void> {
    if (track.provider !== "appleMusic")
      throw new PlaybackError("trackUnavailable", "That card is not an Apple Music song.");
    if (!this.music)
      throw new PlaybackError("notAuthorised", "Connect Apple Music first.");
    this.songId = track.id;
    this.storefront = track.storefront ?? this.storefront;
    try {
      await this.music.setQueue({ song: track.id, startPlaying: false });
    } catch {
      throw new PlaybackError("trackUnavailable", "Apple Music could not load that song.");
    }
  }

  async play(fromMs: number): Promise<AudibleStart> {
    const music = this.music;
    if (!music || !this.kit || !this.songId)
      throw new PlaybackError("notAuthorised", "Connect Apple Music and pick a song first.");
    const playing = this.kit.PlaybackStates.playing;
    const requestedAt = this.clock.now();
    try {
      await music.seekToTime(fromMs / 1000);
      await music.play();
    } catch {
      throw new PlaybackError("trackUnavailable", "Apple Music could not play that song.");
    }
    // Audible once playing, at or past the start, and the position advances.
    let previous: number | undefined;
    while (this.clock.now() - requestedAt < AUDIBLE_TIMEOUT_MS) {
      const position = music.currentPlaybackTime * 1000;
      if (music.playbackState === playing && position >= fromMs) {
        if (previous !== undefined && position > previous) {
          const now = this.clock.now();
          return { requestedAt, audibleAt: now - (position - fromMs), positionMs: position };
        }
        previous = position;
      } else previous = undefined;
      await this.clock.sleep(POLL_MS);
    }
    throw new PlaybackError("timeout", "Apple Music did not start playing in time.");
  }

  async stop(): Promise<void> {
    this.music?.pause();
  }

  async positionMs(): Promise<number | undefined> {
    return this.music ? this.music.currentPlaybackTime * 1000 : undefined;
  }
}
