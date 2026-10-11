// Minimal declarations for the parts of MusicKit JS v3 we use.
declare namespace MusicKit {
  interface Configuration {
    developerToken: string;
    app: { name: string; build: string };
  }
  interface MusicKitInstance {
    authorize(): Promise<string>;
    isAuthorized: boolean;
    storefrontId?: string;
    playbackState: number;
    currentPlaybackTime: number;
    api: { music(path: string): Promise<{ data?: unknown }> };
    setQueue(options: { song: string; startPlaying?: boolean }): Promise<unknown>;
    seekToTime(seconds: number): Promise<unknown>;
    play(): Promise<unknown>;
    pause(): void;
  }
  function configure(configuration: Configuration): Promise<MusicKitInstance>;
  function getInstance(): MusicKitInstance;
  const PlaybackStates: { playing: number; paused: number; stopped: number };
}
interface Window {
  MusicKit?: typeof MusicKit;
}
