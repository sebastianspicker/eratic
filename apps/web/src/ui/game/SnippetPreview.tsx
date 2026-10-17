import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Card } from "../../core/deck";
import { record } from "../../diagnostics";
import {
  ApplePreviewSession, previewTarget, SpotifyPreviewSession, type PreviewFailure, type PreviewSession, type PreviewState,
} from "../../playback/embeddedPreview";
import type { PlaybackProvider } from "../../playback/player";
import { failureText } from "./EmbeddedPreview";
import { backupTrack } from "./playback";

// A hidden provider preview that plays timed snippets (Snippet Ladder without exact
// clips). It loads without autoplay so the host's press is a fresh user gesture,
// and every replay reuses the same loaded player.
export function useSnippetPreview(url: string | undefined, cardId: string | undefined): {
  // False when there is no previewable link or the preview is unavailable or failed.
  usable: boolean;
  ready: boolean;
  active: boolean;
  playing: boolean;
  status: string;
  // False when the preview isn't ready, so nothing started.
  snippet: (lengthMs: number, onAudible: () => void) => boolean;
  stop: () => void;
  // The Spotify iframe stays concealed, exactly like EmbeddedPreview's.
  frame: ReactElement | null;
} {
  const target = url ? previewTarget(url) : undefined;
  // The state belongs to one preview: right after a switch, the previous one's reads as loading.
  const [current, setCurrent] = useState<{ key: string; state: PreviewState; failure?: PreviewFailure }>({ key: "", state: "loading" });
  const [ran, setRan] = useState(false);
  const [length, setLength] = useState(0);
  const [stopped, setStopped] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const session = useRef<PreviewSession | undefined>(undefined);
  const request = useRef(0);
  const currentState = useRef<PreviewState>("loading");
  const key = target ? `${target.provider}/${target.id}/${target.provider === "appleMusic" ? target.storefront : ""}/${cardId}` : "";
  const state = current.key === key ? current.state : "loading";
  useEffect(() => {
    if (!target) return;
    setCurrent({ key, state: "loading" });
    currentState.current = "loading";
    setRan(false);
    setStopped(false);
    let disposed = false;
    // Reported just before the "error" state it explains.
    let failure: PreviewFailure | undefined;
    const notify = (next: PreviewState) => {
      if (disposed) return;
      currentState.current = next;
      setCurrent({ key, state: next, ...(next === "error" && { failure }) });
    };
    const name = target.provider === "spotify" ? "Spotify" : "Apple Music";
    const options = {
      failure: (cause: PreviewFailure) => {
        failure = cause;
        record("preview", `${name}: ${failureText(name, cause)}`);
      },
    };
    const current = target.provider === "spotify"
      ? mount.current ? new SpotifyPreviewSession(mount.current, target.id, notify, options) : undefined
      : new ApplePreviewSession(target.id, target.storefront, notify, options);
    session.current = current;
    return () => {
      disposed = true;
      request.current++;
      current?.dispose();
      if (session.current === current) session.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const usable = Boolean(target) && state !== "unavailable" && state !== "error";
  const status = !target ? ""
    : state === "loading" ? "Loading preview…"
    : state === "unavailable" ? "No hidden preview is available for this song."
    : state === "error" ? failureText(target.provider === "spotify" ? "Spotify" : "Apple Music", current.failure)
    : state === "starting" ? "Starting preview…"
    : state === "playing" ? `Playing ${length / 1000} s…`
    : state === "paused" && ran ? stopped ? "Snippet stopped" : "Snippet finished" : "Preview ready";
  return {
    usable,
    ready: usable && ["ready", "paused", "playing"].includes(state),
    active: usable && (state === "starting" || state === "playing"),
    playing: usable && state === "playing",
    status,
    snippet: (lengthMs, onAudible) => {
      if (!session.current || !["ready", "paused", "playing"].includes(currentState.current)) return false;
      const attempt = ++request.current;
      currentState.current = "starting";
      setCurrent({ key, state: "starting" });
      setRan(true);
      setStopped(false);
      setLength(lengthMs);
      session.current.snippet(0, lengthMs, () => {
        if (request.current !== attempt) return;
        request.current++;
        onAudible();
      });
      return true;
    },
    stop: () => {
      request.current++;
      setStopped(true);
      session.current?.pause();
    },
    frame: target?.provider === "spotify"
      ? <div className="embed-frame concealed" aria-hidden="true" inert ref={mount} />
      : null,
  };
}

// The card's hidden-preview link, when its backup track is a Spotify or Apple Music song.
export function previewUrl(card: Card, provider: PlaybackProvider | undefined): string | undefined {
  const url = backupTrack(card, provider)?.url;
  return url && previewTarget(url) ? url : undefined;
}

// What a snippet tile shows: its title (no usable preview), Play, "Loading…", or Stop
// while its snippet starts or plays.
export type TileSnippetState = "title" | "idle" | "loading" | "starting" | "playing";

// Snippet tiles (Lineup, Original or Imposter without exact clips). Only one hidden
// preview is loaded at a time, because Spotify embeds are heavy: the first tile's
// loads (without playing) when the set is drawn; Play on another tile switches the
// loaded preview to it and plays once it is ready. A preview that can't start from
// the old press returns to ready, so the host presses Play again. After a snippet
// finishes, the next unplayed tile preloads. A failed preview shows that tile's title.
export function useTileSnippets(
  tiles: readonly { id: string; url: string | undefined }[],
  lengthMs: number,
  onStart?: () => void,
): {
  // Some tile can still play a snippet.
  available: boolean;
  tile: (id: string) => TileSnippetState;
  press: (id: string) => void;
  loaded: string | undefined;
  status: string;
  frame: ReactElement | null;
} {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [played, setPlayed] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState<string | undefined>(() => tiles.find((item) => item.url)?.id);
  const [pending, setPending] = useState<string>();
  const [running, setRunning] = useState<string>();
  const stopped = useRef(false);
  const wasActive = useRef(false);
  const url = tiles.find((item) => item.id === loaded)?.url;
  const preview = useSnippetPreview(url, url ? loaded : undefined);
  // The first usable tile other than those excluded, preferring ones not yet played.
  function pick(exclude: readonly string[], heard: readonly string[]): string | undefined {
    const open = tiles.filter((item) => item.url && !exclude.includes(item.id));
    return (open.find((item) => !heard.includes(item.id)) ?? open[0])?.id;
  }
  function start(id: string) {
    stopped.current = false;
    const started = preview.snippet(lengthMs, () =>
      setPlayed((current) => (current.includes(id) ? current : [...current, id])),
    );
    if (!started) return;
    setRunning(id);
    onStart?.();
  }
  // A failed or unavailable preview: that tile shows its title and the next one loads.
  useEffect(() => {
    if (!loaded || !url || preview.usable) return;
    const gone = [...failed, loaded];
    setFailed(gone);
    setPending((current) => (current === loaded ? undefined : current));
    setRunning(undefined);
    setLoaded(pick(gone, played));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, url, preview.usable]);
  // A pressed tile plays as soon as its preview is ready.
  useEffect(() => {
    if (!pending || pending !== loaded || !preview.ready) return;
    setPending(undefined);
    start(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, loaded, preview.ready]);
  // A snippet that played to its end preloads the next tile not yet played.
  useEffect(() => {
    if (preview.active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    const id = running;
    setRunning(undefined);
    if (!id || id !== loaded || pending || stopped.current || !played.includes(id)) return;
    const next = pick([...failed, id], played);
    if (next && !played.includes(next)) setLoaded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.active]);
  const usable = (id: string) => Boolean(tiles.find((item) => item.id === id)?.url) && !failed.includes(id);
  const tile = (id: string): TileSnippetState => {
    if (!usable(id)) return "title";
    if (running === id && id === loaded && preview.active) return preview.playing ? "playing" : "starting";
    return pending === id ? "loading" : "idle";
  };
  return {
    available: tiles.some((item) => usable(item.id)),
    tile,
    press: (id) => {
      if (!usable(id)) return;
      const now = tile(id);
      if (now === "starting" || now === "playing") {
        stopped.current = true;
        preview.stop();
        return;
      }
      if (now === "loading") return;
      if (id === loaded && preview.ready) return start(id);
      setPending(id);
      setLoaded(id);
    },
    loaded: url ? loaded : undefined,
    status: url ? preview.status : "",
    frame: preview.frame,
  };
}
