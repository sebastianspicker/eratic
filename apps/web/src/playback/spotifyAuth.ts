import { PlaybackError } from "./player";

export const SPOTIFY_AUTH_KEY = "eratic.spotify.auth.v1";
const VERIFIER_KEY = "eratic.spotify.verifier";
const STATE_KEY = "eratic.spotify.state";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
// Only what playback needs: the Web Playback SDK (streaming), the account tier
// (user-read-private) and starting a track on the SDK device.
export const SPOTIFY_SCOPES = "streaming user-read-private user-modify-playback-state";
const EXPIRY_MARGIN_MS = 30_000;

export interface SpotifyTokens {
  access: string;
  refresh: string;
  expiresAt: number; // epoch ms (Date.now), so it survives reloads
}
export interface SpotifyAuthDeps {
  fetch?: typeof fetch;
  local?: Storage;
  session?: Storage;
  clientId?: string;
  redirectUri?: string;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
  navigate?: (url: string) => void;
  replaceUrl?: (url: string) => void;
}

const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function webStorage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
export function makeVerifier(
  random: (n: number) => Uint8Array = randomBytes,
  length = 64,
): string {
  // 64 characters divide 256 evenly, so the modulo adds no bias.
  return Array.from(random(length), (b) => CHARSET[b % CHARSET.length]).join("");
}
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export function spotifyClientId(): string | undefined {
  return import.meta.env.VITE_SPOTIFY_CLIENT_ID || undefined;
}
export function spotifyConfigured(deps: SpotifyAuthDeps = {}): boolean {
  return Boolean(deps.clientId ?? spotifyClientId());
}
function requireClientId(deps: SpotifyAuthDeps): string {
  const id = deps.clientId ?? spotifyClientId();
  if (!id)
    throw new PlaybackError("notConfigured", "Spotify is not set up in this build.");
  return id;
}
function redirectUri(deps: SpotifyAuthDeps): string {
  return deps.redirectUri ?? location.origin + location.pathname;
}

export function loadTokens(local = webStorage("localStorage")): SpotifyTokens | undefined {
  try {
    const raw = local?.getItem(SPOTIFY_AUTH_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (
      typeof value?.access === "string" &&
      value.access !== "" &&
      typeof value?.refresh === "string" &&
      value.refresh !== "" &&
      typeof value?.expiresAt === "number"
    )
      return { access: value.access, refresh: value.refresh, expiresAt: value.expiresAt };
  } catch {
    // corrupt: treated as signed out
  }
  return undefined;
}
export function saveTokens(
  tokens: SpotifyTokens,
  local = webStorage("localStorage"),
): void {
  try {
    local?.setItem(SPOTIFY_AUTH_KEY, JSON.stringify(tokens));
  } catch {
    // storage full or blocked: the session still works until reload
  }
}
export function signOutSpotify(local = webStorage("localStorage")): void {
  try {
    local?.removeItem(SPOTIFY_AUTH_KEY);
  } catch {
    // ignore
  }
}

export async function beginSpotifyLogin(deps: SpotifyAuthDeps = {}): Promise<void> {
  const clientId = requireClientId(deps);
  const session = deps.session ?? webStorage("sessionStorage");
  const random = deps.randomBytes ?? randomBytes;
  const verifier = makeVerifier(random);
  const state = makeVerifier(random, 24);
  try {
    session?.setItem(VERIFIER_KEY, verifier);
    session?.setItem(STATE_KEY, state);
  } catch {
    throw new PlaybackError("notAuthorised", "This browser blocks the storage Spotify sign-in needs.");
  }
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(deps),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    state,
  });
  const url = `${AUTHORIZE_URL}?${query}`;
  (deps.navigate ?? ((u) => location.assign(u)))(url);
}

async function tokenRequest(
  body: URLSearchParams,
  deps: SpotifyAuthDeps,
  previousRefresh?: string,
): Promise<SpotifyTokens> {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new PlaybackError("network", "Could not reach Spotify.");
  }
  if (!response.ok)
    throw new PlaybackError("notAuthorised", "Spotify sign-in was refused. Try connecting again.");
  const json = (await response.json().catch(() => undefined)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    | undefined;
  const now = deps.now ?? Date.now;
  const access = json?.access_token;
  // A refresh response may omit a new refresh token; keep the old one.
  const refresh = json?.refresh_token === undefined ? previousRefresh : json.refresh_token;
  if (typeof access !== "string" || access === "" || typeof refresh !== "string" || refresh === "")
    throw new PlaybackError("notAuthorised", "Spotify sent an unusable sign-in response. Try connecting again.");
  const seconds = Number(json?.expires_in ?? 3600);
  return {
    access,
    refresh,
    expiresAt: now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  };
}

// Handles the redirect back from Spotify. Returns false if the URL is not one.
export async function completeSpotifyLogin(
  href: string,
  deps: SpotifyAuthDeps = {},
): Promise<boolean> {
  const url = new URL(href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code && !error) return false;
  const session = deps.session ?? webStorage("sessionStorage");
  const expectedState = session?.getItem(STATE_KEY) ?? null;
  const verifier = session?.getItem(VERIFIER_KEY) ?? null;
  const stateOk = expectedState !== null && url.searchParams.get("state") === expectedState;
  // Drop the one-time values and the query whatever happens next.
  session?.removeItem(STATE_KEY);
  session?.removeItem(VERIFIER_KEY);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  (deps.replaceUrl ?? ((u) => history.replaceState(null, "", u)))(
    url.pathname + url.search + url.hash,
  );
  if (error) throw new PlaybackError("notAuthorised", "Spotify sign-in was cancelled.");
  if (!stateOk || !verifier)
    throw new PlaybackError("notAuthorised", "Spotify sign-in could not be verified. Try again.");
  const tokens = await tokenRequest(
    new URLSearchParams({
      client_id: requireClientId(deps),
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri(deps),
      code_verifier: verifier,
    }),
    deps,
  );
  saveTokens(tokens, deps.local ?? webStorage("localStorage"));
  return true;
}

export async function refreshTokens(
  tokens: SpotifyTokens,
  deps: SpotifyAuthDeps = {},
): Promise<SpotifyTokens> {
  const fresh = await tokenRequest(
    new URLSearchParams({
      client_id: requireClientId(deps),
      grant_type: "refresh_token",
      refresh_token: tokens.refresh,
    }),
    deps,
    tokens.refresh,
  ).catch((error) => {
    if (error instanceof PlaybackError && error.code === "notAuthorised")
      signOutSpotify(deps.local ?? webStorage("localStorage"));
    throw error;
  });
  saveTokens(fresh, deps.local ?? webStorage("localStorage"));
  return fresh;
}

// Concurrent callers share one refresh per token store, so a rotated refresh
// token is never sent twice.
const refreshing = new WeakMap<object, Promise<SpotifyTokens>>();
const NO_STORAGE = {};

// A usable access token, refreshing when expired; throws notAuthorised if signed out.
export async function accessToken(
  deps: SpotifyAuthDeps = {},
  force = false,
): Promise<string> {
  const local = deps.local ?? webStorage("localStorage");
  const key: object = local ?? NO_STORAGE;
  const pending = refreshing.get(key);
  if (pending) return (await pending).access;
  const tokens = loadTokens(local);
  if (!tokens)
    throw new PlaybackError("notAuthorised", "Connect Spotify first.");
  const now = deps.now ?? Date.now;
  if (!force && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) return tokens.access;
  const refresh = refreshTokens(tokens, deps).finally(() => refreshing.delete(key));
  refreshing.set(key, refresh);
  return (await refresh).access;
}
