import { systemClock, type Clock } from "./clock";
import {
  PlaybackError,
  type AudibleStart,
  type PlayableTrack,
  type PlaybackTier,
  type Player,
} from "./player";
import { accessToken, spotifyConfigured, type SpotifyAuthDeps } from "./spotifyAuth";
import { loadScript } from "./scriptLoader";

const API = "https://api.spotify.com/v1";
const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const POLL_MS = 50;
const AUDIBLE_TIMEOUT_MS = 10_000;
const DEVICE_TIMEOUT_MS = 10_000;

export interface SpotifyPlayerDeps {
  clock?: Clock;
  fetch?: typeof fetch;
  auth?: SpotifyAuthDeps;
  // Resolves once window.Spotify exists; tests pass a fake.
  loadSdk?: () => Promise<typeof Spotify>;
}

// One load shared by every caller: a second call must not replace the ready
// callback the first one is waiting on. A failed load can be retried.
let sdkLoading: Promise<typeof Spotify> | undefined;
export function loadSpotifySdk(): Promise<typeof Spotify> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  sdkLoading ??= new Promise<typeof Spotify>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify!);
    loadScript(SDK_URL).catch(() => {
      sdkLoading = undefined;
      reject(new PlaybackError("network", "Could not load Spotify's player."));
    });
  });
  return sdkLoading;
}

export class SpotifyPlayer implements Player {
  readonly provider = "spotify" as const;
  private current: PlaybackTier;
  private sdk?: Spotify.Player;
  private deviceId?: string;
  private trackId?: string;
  private clock: Clock;
  private doFetch: typeof fetch;
  private auth: SpotifyAuthDeps;
  private loadSdk: () => Promise<typeof Spotify>;

  constructor(deps: SpotifyPlayerDeps = {}) {
    this.clock = deps.clock ?? systemClock;
    this.doFetch = deps.fetch ?? ((...args) => globalThis.fetch(...args));
    this.auth = { fetch: this.doFetch, ...deps.auth };
    this.loadSdk = deps.loadSdk ?? loadSpotifySdk;
    this.current = {
      kind: "unavailable",
      reason: spotifyConfigured(this.auth)
        ? "Not connected yet."
        : "Spotify is not set up in this build.",
    };
  }

  tier(): PlaybackTier {
    return this.current;
  }

  // Authorised API call: refresh once on 401, honour Retry-After once on 429.
  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    let token = await accessToken(this.auth);
    let refreshed = false;
    let retried = false;
    for (;;) {
      let response: Response;
      try {
        response = await this.doFetch(`${API}${path}`, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch {
        throw new PlaybackError("network", "Could not reach Spotify.");
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await accessToken(this.auth, true);
        continue;
      }
      if (response.status === 429 && !retried) {
        retried = true;
        const seconds = Number(response.headers.get("Retry-After"));
        await this.clock.sleep((Number.isFinite(seconds) ? seconds : 1) * 1000);
        continue;
      }
      if (response.status === 401)
        throw new PlaybackError("notAuthorised", "Spotify sign-in expired. Connect again.");
      return response;
    }
  }

  async connect(): Promise<void> {
    if (!spotifyConfigured(this.auth)) {
      this.current = { kind: "unavailable", reason: "Spotify is not set up in this build." };
      throw new PlaybackError("notConfigured", "Spotify is not set up in this build.");
    }
    const me = await this.api("/me");
    if (!me.ok) throw new PlaybackError("notAuthorised", "Could not read your Spotify account.");
    const profile = await me.json();
    // The Web Playback SDK needs Premium; anything else plays by hand.
    if (profile.product !== "premium") {
      this.current = { kind: "noExactPlayback" };
      return;
    }
    // Exact clips only once this browser's player is ready; until then, and after a
    // failure, the tier says why playback is unavailable.
    try {
      await this.startDevice();
    } catch (error) {
      if (error instanceof PlaybackError && error.code === "noSubscription") {
        this.current = { kind: "noExactPlayback" };
        return;
      }
      this.current = {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : "Spotify's player did not start.",
      };
      throw error;
    }
    this.current = { kind: "fullTrack" };
  }

  private async startDevice(): Promise<void> {
    if (this.deviceId) return;
    const sdk = await this.loadSdk();
    const player = new sdk.Player({
      name: "Eratic",
      getOAuthToken: (callback) => {
        accessToken(this.auth).then(callback, () => {});
      },
      volume: 0.8,
    });
    const ready = new Promise<string>((resolve, reject) => {
      player.addListener("ready", ({ device_id }) => resolve(device_id));
      player.addListener("account_error", () =>
        reject(new PlaybackError("noSubscription", "Spotify Premium is needed for timed clips.")),
      );
      player.addListener("authentication_error", () =>
        reject(new PlaybackError("notAuthorised", "Spotify sign-in expired. Connect again.")),
      );
      player.addListener("initialization_error", () =>
        reject(new PlaybackError("noActiveDevice", "This browser cannot play Spotify audio.")),
      );
      void this.clock.sleep(DEVICE_TIMEOUT_MS).then(() =>
        reject(new PlaybackError("noActiveDevice", "Spotify's player did not start.")),
      );
    });
    ready.catch(() => {}); // a rejection before anyone awaits is not unhandled
    if (!(await player.connect()))
      throw new PlaybackError("noActiveDevice", "Spotify's player could not connect.");
    try {
      this.deviceId = await ready;
    } catch (error) {
      player.disconnect();
      throw error;
    }
    this.sdk = player;
  }

  async prepare(track: PlayableTrack): Promise<void> {
    if (track.provider !== "spotify")
      throw new PlaybackError("trackUnavailable", "That card is not a Spotify track.");
    this.trackId = track.id;
  }

  async play(fromMs: number): Promise<AudibleStart> {
    if (!this.sdk || !this.deviceId)
      throw new PlaybackError("noActiveDevice", "Spotify's player is not ready. Connect first.");
    if (!this.trackId) throw new PlaybackError("trackUnavailable", "No track is prepared.");
    const requestedAt = this.clock.now();
    const response = await this.api(
      `/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uris: [`spotify:track:${this.trackId}`],
          position_ms: Math.round(fromMs),
        }),
      },
    );
    if (response.status === 404)
      throw new PlaybackError("noActiveDevice", "Spotify's player is not available. Connect again.");
    if (response.status === 403)
      throw new PlaybackError("noSubscription", "Spotify Premium is needed for timed clips.");
    if (!response.ok)
      throw new PlaybackError("trackUnavailable", "Spotify could not play that track.");
    // Audible once unpaused on this track, at or past the start, and advancing.
    let previous: number | undefined;
    while (this.clock.now() - requestedAt < AUDIBLE_TIMEOUT_MS) {
      const state = await this.sdk.getCurrentState();
      if (
        state &&
        !state.paused &&
        state.track_window.current_track.id === this.trackId &&
        state.position >= fromMs
      ) {
        if (previous !== undefined && state.position > previous) {
          const now = this.clock.now();
          return {
            requestedAt,
            audibleAt: now - (state.position - fromMs),
            positionMs: state.position,
          };
        }
        previous = state.position;
      } else previous = undefined;
      await this.clock.sleep(POLL_MS);
    }
    throw new PlaybackError("timeout", "Spotify did not start playing in time.");
  }

  async stop(): Promise<void> {
    await this.sdk?.pause();
  }

  async positionMs(): Promise<number | undefined> {
    return (await this.sdk?.getCurrentState())?.position;
  }
}
