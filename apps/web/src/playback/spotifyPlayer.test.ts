import { describe, expect, it } from "vitest";
import { SpotifyPlayer } from "./spotifyPlayer";
import { saveTokens } from "./spotifyAuth";
import { FakeClock, jsonResponse, memoryStorage } from "./testing";

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body?: string;
}

// Scripted Spotify: the track becomes audible `audibleDelay` ms after the play request.
function setup(opts: {
  product?: string;
  audibleDelay?: number | "never";
  playStatuses?: number[]; // statuses for successive play requests
  meStatuses?: number[];
  retryAfter?: string;
  accountError?: boolean;
  noReady?: boolean;
}) {
  const clock = new FakeClock();
  const local = memoryStorage();
  saveTokens({ access: "old", refresh: "r", expiresAt: Date.now() + 3_600_000 }, local);
  const calls: Call[] = [];
  let playedAt: number | undefined;
  let playedFrom = 0;
  let paused = true;
  const playStatuses = [...(opts.playStatuses ?? [204])];
  const meStatuses = [...(opts.meStatuses ?? [200])];
  const fetchFake = (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({
      method: init.method ?? "GET",
      url,
      auth: headers.get("Authorization"),
      body: init.body ? String(init.body) : undefined,
    });
    if (url.includes("accounts.spotify.com"))
      return jsonResponse({ access_token: "new", refresh_token: "r", expires_in: 3600 });
    if (url.endsWith("/me")) {
      const status = meStatuses.shift() ?? 200;
      return status === 200
        ? jsonResponse({ product: opts.product ?? "premium" })
        : new Response("", { status });
    }
    if (url.includes("/me/player/play")) {
      const status = playStatuses.shift() ?? 204;
      const headers: Record<string, string> = opts.retryAfter ? { "Retry-After": opts.retryAfter } : {};
      if (status === 204) {
        playedAt = clock.now();
        playedFrom = JSON.parse(String(init.body)).position_ms;
        paused = false;
      }
      return new Response(null, { status, headers });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  class FakePlayer {
    handlers = new Map<string, (e: never) => void>();
    pauses = 0;
    constructor(public init: Spotify.PlayerInit) {}
    addListener(event: string, cb: (e: never) => void) {
      this.handlers.set(event, cb);
      return true;
    }
    async connect() {
      if (opts.accountError) this.handlers.get("account_error")?.({ message: "x" } as never);
      else if (!opts.noReady) this.handlers.get("ready")?.({ device_id: "dev-1" } as never);
      return true;
    }
    disconnect() {}
    async pause() {
      this.pauses++;
      paused = true;
    }
    async getCurrentState() {
      if (playedAt === undefined) return null;
      const delay = opts.audibleDelay ?? 0;
      const audible = delay !== "never" && clock.now() - playedAt >= delay;
      const position = audible ? playedFrom + (clock.now() - playedAt - delay) : playedFrom;
      return {
        paused: paused || !audible,
        position,
        duration: 200_000,
        track_window: { current_track: { id: "trk", uri: "spotify:track:trk" } },
      } as Spotify.PlaybackState;
    }
  }
  const sdks: FakePlayer[] = [];
  const sdk = {
    Player: class extends FakePlayer {
      constructor(init: Spotify.PlayerInit) {
        super(init);
        sdks.push(this);
      }
    },
  } as unknown as typeof Spotify;
  const player = new SpotifyPlayer({
    clock,
    fetch: fetchFake,
    auth: { clientId: "cid", local, now: () => Date.now() },
    loadSdk: async () => sdk,
  });
  return { player, clock, calls, sdks };
}

const track = { provider: "spotify", id: "trk" } as const;

describe("SpotifyPlayer", () => {
  it("is full track for Premium and creates a named device", async () => {
    const { player, sdks, calls } = setup({});
    await player.connect();
    expect(player.tier()).toEqual({ kind: "fullTrack" });
    expect(sdks[0].init.name).toBe("Eratic");
    expect(sdks[0].init.volume).toBe(0.8);
    expect(calls[0].auth).toBe("Bearer old");
  });

  it("has no exact playback for free accounts and never loads the SDK", async () => {
    const { player, sdks } = setup({ product: "free" });
    await player.connect();
    expect(player.tier()).toEqual({ kind: "noExactPlayback" });
    expect(sdks).toHaveLength(0);
  });

  it("falls back to no exact playback on an SDK account_error", async () => {
    const { player } = setup({ accountError: true });
    await player.connect();
    expect(player.tier()).toEqual({ kind: "noExactPlayback" });
  });

  it("times out when no device becomes ready", async () => {
    const { player, clock } = setup({ noReady: true });
    const result = player.connect().then(
      () => "ok",
      (e) => e.code,
    );
    await clock.advance(10_001);
    expect(await result).toBe("noActiveDevice");
    // Never "exact clips" without a ready player; the reason is shown instead.
    expect(player.tier()).toEqual({ kind: "unavailable", reason: "Spotify's player did not start." });
  });

  it("is not configured without a client id", async () => {
    const player = new SpotifyPlayer({ auth: { clientId: "" }, fetch: (async () => {
      throw new Error("no network");
    }) as unknown as typeof fetch });
    await expect(player.connect()).rejects.toMatchObject({ code: "notConfigured" });
    expect(player.tier().kind).toBe("unavailable");
  });

  it("sends uri and position and reports the audible start", async () => {
    const { player, clock, calls } = setup({ audibleDelay: 400 });
    await player.connect();
    await player.prepare(track);
    const started = player.play(30_000);
    await clock.advance(1000);
    const result = await started;
    const request = calls.find((c) => c.url.includes("/me/player/play"))!;
    expect(request.method).toBe("PUT");
    expect(request.url).toContain("device_id=dev-1");
    expect(JSON.parse(request.body!)).toEqual({
      uris: ["spotify:track:trk"],
      position_ms: 30_000,
    });
    expect(result.requestedAt).toBe(0);
    // Polling at 50 ms sees sound at 400 ms; audibleAt is back-computed from position.
    expect(result.audibleAt).toBeGreaterThanOrEqual(400);
    expect(result.audibleAt).toBeLessThanOrEqual(450);
    expect(result.positionMs).toBeGreaterThan(30_000);
  });

  it("refreshes the token once on 401 and retries", async () => {
    const { player, clock, calls } = setup({ playStatuses: [401, 204] });
    await player.connect();
    await player.prepare(track);
    const started = player.play(0);
    await clock.advance(500);
    await started;
    const plays = calls.filter((c) => c.url.includes("/me/player/play"));
    expect(plays.map((c) => c.auth)).toEqual(["Bearer old", "Bearer new"]);
    expect(calls.some((c) => c.url.includes("accounts.spotify.com"))).toBe(true);
  });

  it("gives up after a second 401", async () => {
    const { player } = setup({ meStatuses: [401, 401] });
    await expect(player.connect()).rejects.toMatchObject({ code: "notAuthorised" });
  });

  it("waits for Retry-After once on 429", async () => {
    const { player, clock, calls } = setup({ playStatuses: [429, 204], retryAfter: "2" });
    await player.connect();
    await player.prepare(track);
    const started = player.play(0);
    await clock.advance(1900);
    expect(calls.filter((c) => c.url.includes("/me/player/play"))).toHaveLength(1);
    await clock.advance(1200);
    await started;
    expect(calls.filter((c) => c.url.includes("/me/player/play"))).toHaveLength(2);
  });

  it("maps a missing device to noActiveDevice", async () => {
    const { player } = setup({ playStatuses: [404] });
    await player.connect();
    await player.prepare(track);
    await expect(player.play(0)).rejects.toMatchObject({ code: "noActiveDevice" });
  });

  it("times out when audio never starts", async () => {
    const { player, clock } = setup({ audibleDelay: "never" });
    await player.connect();
    await player.prepare(track);
    const result = player.play(0).then(
      () => "ok",
      (e) => e.code,
    );
    await clock.advance(11_000);
    expect(await result).toBe("timeout");
  });

  it("stop pauses the SDK player", async () => {
    const { player, sdks } = setup({});
    await player.connect();
    await player.stop();
    expect(sdks[0].pauses).toBe(1);
  });
});
