import { AppleMusicPlayer, appleMusicToken } from "./appleMusicPlayer";
import { systemClock, type Clock } from "./clock";
import { ManualPlayer } from "./manualPlayer";
import {
  PlaybackError,
  type PlaybackProvider,
  type PlaybackTier,
  type Player,
} from "./player";
import { spotifyConfigured } from "./spotifyAuth";
import { SpotifyPlayer } from "./spotifyPlayer";

export interface HubState {
  provider: PlaybackProvider | undefined;
  tier: PlaybackTier | undefined;
  error: string | undefined;
  connecting: boolean;
}

// Holds the chosen provider; adapters are created only when asked for.
export class PlaybackHub {
  private players = new Map<PlaybackProvider, Player>();
  private listeners = new Set<() => void>();
  private snapshot: HubState = {
    provider: undefined,
    tier: undefined,
    error: undefined,
    connecting: false,
  };

  constructor(
    private clock: Clock = systemClock,
    private factories: Partial<Record<PlaybackProvider, () => Player>> = {},
    private configured: Record<PlaybackProvider, boolean> = {
      spotify: spotifyConfigured(),
      appleMusic: Boolean(appleMusicToken()),
      manual: true,
    },
  ) {}

  get state(): HubState {
    return this.snapshot;
  }
  get player(): Player | undefined {
    return this.snapshot.provider && this.players.get(this.snapshot.provider);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private set(patch: Partial<HubState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  availableProviders(): PlaybackProvider[] {
    return (["spotify", "appleMusic", "manual"] as const).filter((p) => this.configured[p]);
  }

  private create(provider: PlaybackProvider): Player {
    let player = this.players.get(provider);
    if (!player) {
      const make = this.factories[provider];
      player =
        make?.() ??
        (provider === "spotify"
          ? new SpotifyPlayer({ clock: this.clock })
          : provider === "appleMusic"
            ? new AppleMusicPlayer({ clock: this.clock })
            : new ManualPlayer(this.clock));
      this.players.set(provider, player);
    }
    return player;
  }

  async connect(provider: PlaybackProvider): Promise<void> {
    if (!this.configured[provider]) {
      this.set({
        provider: undefined,
        tier: undefined,
        error: "That provider is not set up in this build.",
      });
      return;
    }
    const player = this.create(provider);
    this.set({ provider, tier: player.tier(), error: undefined, connecting: true });
    try {
      await player.connect();
      this.set({ tier: player.tier(), connecting: false });
    } catch (error) {
      this.set({
        tier: player.tier(),
        connecting: false,
        error:
          error instanceof PlaybackError ? error.message : "Could not connect. Try again.",
      });
    }
  }
}
