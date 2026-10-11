import { describe, expect, it } from "vitest";
import { AppleMusicPlayer } from "./appleMusicPlayer";
import { FakeClock } from "./testing";

function setup(opts: { storefrontFails?: boolean; authorised?: boolean; alreadyAuthorized?: boolean; startDelay?: number } = {}) {
  const clock = new FakeClock();
  const log: string[] = [];
  let playedAt: number | undefined;
  let from = 0;
  const music = {
    isAuthorized: opts.alreadyAuthorized ?? false,
    storefrontId: "de",
    get playbackState() {
      const delay = opts.startDelay ?? 0;
      return playedAt !== undefined && clock.now() - playedAt >= delay ? 2 : 0;
    },
    get currentPlaybackTime() {
      if (playedAt === undefined) return from;
      return from + Math.max(0, clock.now() - playedAt - (opts.startDelay ?? 0)) / 1000;
    },
    api: {
      music: async (path: string) => {
        log.push(`api ${path}`);
        if (opts.storefrontFails) throw new Error("403");
        return { data: {} };
      },
    },
    authorize: async () => {
      log.push("authorize");
      music.isAuthorized = opts.authorised ?? true;
      return "token";
    },
    setQueue: async (o: unknown) => void log.push(`queue ${JSON.stringify(o)}`),
    seekToTime: async (s: number) => {
      from = s;
      log.push(`seek ${s}`);
    },
    play: async () => {
      playedAt = clock.now();
      log.push("play");
    },
    pause: () => void log.push("pause"),
  };
  const configured: unknown[] = [];
  const kit = {
    configure: async (c: unknown) => {
      configured.push(c);
      return music;
    },
    PlaybackStates: { playing: 2, paused: 3, stopped: 0 },
  } as unknown as typeof MusicKit;
  const player = new AppleMusicPlayer({ clock, developerToken: "dev", loadSdk: async () => kit });
  return { player, clock, log, configured };
}

describe("AppleMusicPlayer", () => {
  it("uses app links without prompting when MusicKit has no existing authorization", async () => {
    const { player, log } = setup();
    await player.connect();
    expect(player.tier()).toEqual({ kind: "noExactPlayback" });
    expect(log).toEqual([]);
  });

  it("reuses MusicKit authorization without requesting credentials again", async () => {
    const { player, log, configured } = setup({ alreadyAuthorized: true });
    await player.connect();
    await player.connect(true);
    expect(player.tier()).toEqual({ kind: "fullTrack" });
    expect(log).not.toContain("authorize");
    expect(configured).toHaveLength(1);
  });

  it("offers manual playback without a developer token", async () => {
    const player = new AppleMusicPlayer({ developerToken: "" });
    expect(player.tier().kind).toBe("unavailable");
    await player.connect();
    expect(player.tier()).toEqual({ kind: "noExactPlayback" });
  });

  it("configures MusicKit and reports full tracks when the storefront call works", async () => {
    const { player, configured, log } = setup();
    await player.connect(true);
    expect(configured[0]).toEqual({
      developerToken: "dev",
      app: { name: "Eratic", build: "0.1.0" },
    });
    expect(log).toContain("api /v1/me/storefront");
    expect(player.tier()).toEqual({ kind: "fullTrack" });
  });

  it("falls back to 30 s previews when the storefront call fails", async () => {
    const { player } = setup({ storefrontFails: true });
    await player.connect(true);
    expect(player.tier()).toEqual({ kind: "previewOnly", maxMs: 30_000 });
  });

  it("reports notAuthorised when the user declines", async () => {
    const { player } = setup({ authorised: false });
    await expect(player.connect(true)).rejects.toMatchObject({ code: "notAuthorised" });
  });

  it("queues, seeks, plays and finds the audible start", async () => {
    const { player, clock, log } = setup({ startDelay: 300 });
    await player.connect(true);
    await player.prepare({ provider: "appleMusic", id: "123", storefront: "us" });
    const started = player.play(30_000);
    await clock.advance(800);
    const result = await started;
    expect(log).toContain('queue {"song":"123","startPlaying":false}');
    expect(log.indexOf("seek 30")).toBeLessThan(log.lastIndexOf("play"));
    expect(result.audibleAt).toBeGreaterThanOrEqual(300);
    expect(result.audibleAt).toBeLessThanOrEqual(400);
    await player.stop();
    expect(log.at(-1)).toBe("pause");
  });
});
