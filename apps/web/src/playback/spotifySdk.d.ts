// Minimal declarations for the parts of the Spotify Web Playback SDK we use.
declare namespace Spotify {
  interface Track {
    id: string | null;
    uri: string;
    // Set when Spotify plays a market-specific copy (relinking) of the requested track.
    linked_from?: { id: string | null; uri: string | null };
  }
  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: { current_track: Track };
  }
  interface WebPlaybackError {
    message: string;
  }
  interface PlayerInit {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
  }
  class Player {
    constructor(init: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    pause(): Promise<void>;
    getCurrentState(): Promise<PlaybackState | null>;
    addListener(event: "ready" | "not_ready", cb: (e: { device_id: string }) => void): boolean;
    addListener(
      event: "account_error" | "authentication_error" | "initialization_error" | "playback_error",
      cb: (e: WebPlaybackError) => void,
    ): boolean;
  }
}
interface Window {
  Spotify?: typeof Spotify;
  onSpotifyWebPlaybackSDKReady?: () => void;
}
