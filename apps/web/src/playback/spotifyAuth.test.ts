import { describe, expect, it, vi } from "vitest";
import {
  SPOTIFY_AUTH_KEY,
  SPOTIFY_SCOPES,
  accessToken,
  beginSpotifyLogin,
  challengeFor,
  completeSpotifyLogin,
  loadTokens,
  makeVerifier,
  saveTokens,
  type SpotifyAuthDeps,
} from "./spotifyAuth";
import { PlaybackError } from "./player";
import { jsonResponse, memoryStorage } from "./testing";

const REDIRECT = "https://eratic.example/app/";
function deps(over: Partial<SpotifyAuthDeps> = {}) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const base: SpotifyAuthDeps = {
    clientId: "client-1",
    redirectUri: REDIRECT,
    local: memoryStorage(),
    session: memoryStorage(),
    now: () => 1_000_000,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
    navigate: vi.fn(),
    replaceUrl: vi.fn(),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      return jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 3600 });
    }) as unknown as typeof fetch,
    ...over,
  };
  return { d: base, calls };
}

describe("PKCE", () => {
  it("makes a 64 character verifier from the allowed alphabet", () => {
    const v = makeVerifier();
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
  });
  it("derives the RFC 7636 appendix B challenge", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("login", () => {
  it("reports not configured without a client id", async () => {
    const { d } = deps({ clientId: "" });
    // an empty override falls back to the (unset) build variable
    await expect(beginSpotifyLogin(d)).rejects.toMatchObject({ code: "notConfigured" });
  });

  it("redirects to Spotify with S256, scopes and the stored state", async () => {
    const { d } = deps();
    await beginSpotifyLogin(d);
    const url = new URL((d.navigate as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")).toContain("streaming");
    expect(url.searchParams.get("state")).toBe(d.session!.getItem("eratic.spotify.state"));
    const verifier = d.session!.getItem("eratic.spotify.verifier")!;
    expect(url.searchParams.get("code_challenge")).toBe(await challengeFor(verifier));
  });

  it("exchanges the code, stores tokens and cleans the URL", async () => {
    const { d, calls } = deps();
    await beginSpotifyLogin(d);
    const state = d.session!.getItem("eratic.spotify.state")!;
    const verifier = d.session!.getItem("eratic.spotify.verifier")!;
    const ok = await completeSpotifyLogin(`${REDIRECT}?code=abc&state=${state}&x=1`, d);
    expect(ok).toBe(true);
    expect(calls[0].body.get("code_verifier")).toBe(verifier);
    expect(calls[0].body.get("code")).toBe("abc");
    expect(calls[0].body.get("grant_type")).toBe("authorization_code");
    expect(loadTokens(d.local as Storage)).toEqual({
      access: "A2",
      refresh: "R2",
      expiresAt: 1_000_000 + 3_600_000,
    });
    expect(d.replaceUrl).toHaveBeenCalledWith("/app/?x=1");
    expect(d.session!.getItem("eratic.spotify.verifier")).toBeNull();
  });

  it("rejects a state mismatch without calling the token endpoint", async () => {
    const { d, calls } = deps();
    await beginSpotifyLogin(d);
    await expect(
      completeSpotifyLogin(`${REDIRECT}?code=abc&state=wrong`, d),
    ).rejects.toMatchObject({ code: "notAuthorised" });
    expect(calls).toHaveLength(0);
    expect(loadTokens(d.local as Storage)).toBeUndefined();
    expect(d.replaceUrl).toHaveBeenCalled();
  });

  it("ignores URLs that are not a login redirect", async () => {
    const { d } = deps();
    expect(await completeSpotifyLogin(REDIRECT, d)).toBe(false);
  });
});

describe("tokens", () => {
  it("returns a valid token without a network call", async () => {
    const { d, calls } = deps();
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 2_000_000 }, d.local as Storage);
    expect(await accessToken(d)).toBe("A1");
    expect(calls).toHaveLength(0);
  });

  it("refreshes an expired token and keeps the refresh token if none is returned", async () => {
    const { d, calls } = deps({
      fetch: (async () =>
        jsonResponse({ access_token: "A3", expires_in: 100 })) as unknown as typeof fetch,
    });
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 999_000 }, d.local as Storage);
    expect(await accessToken(d)).toBe("A3");
    expect(calls).toHaveLength(0);
    expect(loadTokens(d.local as Storage)).toMatchObject({ access: "A3", refresh: "R1" });
  });

  it("sends the refresh grant", async () => {
    const { d, calls } = deps();
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 0 }, d.local as Storage);
    expect(await accessToken(d)).toBe("A2");
    expect(calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(calls[0].body.get("refresh_token")).toBe("R1");
  });

  it("requires sign-in when nothing is stored, and ignores corrupt storage", async () => {
    const { d } = deps();
    await expect(accessToken(d)).rejects.toBeInstanceOf(PlaybackError);
    d.local!.setItem(SPOTIFY_AUTH_KEY, "{nope");
    expect(loadTokens(d.local as Storage)).toBeUndefined();
  });

  it("signs out when the refresh token is refused", async () => {
    const { d } = deps({
      fetch: (async () => jsonResponse({}, 400)) as unknown as typeof fetch,
    });
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 0 }, d.local as Storage);
    await expect(accessToken(d)).rejects.toMatchObject({ code: "notAuthorised" });
    expect(d.local!.getItem(SPOTIFY_AUTH_KEY)).toBeNull();
  });
});

describe("hardening", () => {
  it("asks only for the scopes playback needs", () => {
    expect(SPOTIFY_SCOPES).toBe("streaming user-read-private user-modify-playback-state");
  });

  it("rejects a token response without a usable access or refresh token and stores nothing", async () => {
    for (const body of [
      { refresh_token: "R2", expires_in: 3600 },
      { access_token: "", refresh_token: "R2" },
      { access_token: 42, refresh_token: "R2" },
      { access_token: "A2" },
      { access_token: "A2", refresh_token: "" },
    ]) {
      const { d } = deps({ fetch: (async () => jsonResponse(body)) as unknown as typeof fetch });
      await beginSpotifyLogin(d);
      const state = d.session!.getItem("eratic.spotify.state")!;
      await expect(completeSpotifyLogin(`${REDIRECT}?code=abc&state=${state}`, d)).rejects.toMatchObject({
        code: "notAuthorised",
      });
      expect(loadTokens(d.local as Storage)).toBeUndefined();
    }
  });

  it("rejects a refresh response that blanks the refresh token", async () => {
    const { d } = deps({
      fetch: (async () => jsonResponse({ access_token: "A3", refresh_token: "" })) as unknown as typeof fetch,
    });
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 0 }, d.local as Storage);
    await expect(accessToken(d)).rejects.toMatchObject({ code: "notAuthorised" });
  });

  it("shares one refresh between concurrent callers", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetch = vi.fn(async () => {
      await gate;
      return jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 3600 });
    });
    const { d } = deps({ fetch: fetch as unknown as typeof globalThis.fetch });
    saveTokens({ access: "A1", refresh: "R1", expiresAt: 0 }, d.local as Storage);
    const first = accessToken(d);
    const second = accessToken(d);
    const forced = accessToken(d, true);
    release();
    expect(await Promise.all([first, second, forced])).toEqual(["A2", "A2", "A2"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loadTokens(d.local as Storage)).toMatchObject({ access: "A2", refresh: "R2" });
  });

  it("treats stored empty tokens as signed out", () => {
    const local = memoryStorage();
    local.setItem(SPOTIFY_AUTH_KEY, JSON.stringify({ access: "", refresh: "R1", expiresAt: 5 }));
    expect(loadTokens(local)).toBeUndefined();
    local.setItem(SPOTIFY_AUTH_KEY, JSON.stringify({ access: "A1", refresh: "", expiresAt: 5 }));
    expect(loadTokens(local)).toBeUndefined();
  });
});
