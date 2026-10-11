import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  ApplePreviewSession, previewTarget, SpotifyPreviewSession, type PreviewSession, type PreviewState,
} from "../../playback/embeddedPreview";

// A hidden provider preview that plays timed snippets (Snippet Ladder without exact
// clips). It loads without autoplay so the host's press is a fresh user gesture,
// and every replay reuses the same loaded player.
export function useSnippetPreview(url: string | undefined, cardId: string | undefined): {
  // False when there is no previewable link or the preview is unavailable or failed.
  usable: boolean;
  ready: boolean;
  active: boolean;
  status: string;
  snippet: (lengthMs: number, onAudible: () => void) => void;
  stop: () => void;
  // The Spotify iframe stays concealed, exactly like EmbeddedPreview's.
  frame: ReactElement | null;
} {
  const target = url ? previewTarget(url) : undefined;
  const [state, setState] = useState<PreviewState>("loading");
  const [ran, setRan] = useState(false);
  const [length, setLength] = useState(0);
  const [stopped, setStopped] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const session = useRef<PreviewSession | undefined>(undefined);
  const request = useRef(0);
  const currentState = useRef<PreviewState>("loading");
  const key = target ? `${target.provider}/${target.id}/${target.provider === "appleMusic" ? target.storefront : ""}/${cardId}` : "";
  useEffect(() => {
    if (!target) return;
    setState("loading");
    currentState.current = "loading";
    setRan(false);
    setStopped(false);
    let disposed = false;
    const notify = (next: PreviewState) => {
      if (disposed) return;
      currentState.current = next;
      setState(next);
    };
    const current = target.provider === "spotify"
      ? mount.current ? new SpotifyPreviewSession(mount.current, target.id, notify) : undefined
      : new ApplePreviewSession(target.id, target.storefront, notify);
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
    : state === "error" ? "The preview could not play."
    : state === "starting" ? "Starting preview…"
    : state === "playing" ? `Playing ${length / 1000} s…`
    : state === "paused" && ran ? stopped ? "Snippet stopped" : "Snippet finished" : "Preview ready";
  return {
    usable,
    ready: usable && ["ready", "paused", "playing"].includes(state),
    active: usable && (state === "starting" || state === "playing"),
    status,
    snippet: (lengthMs, onAudible) => {
      if (!session.current || !["ready", "paused", "playing"].includes(currentState.current)) return;
      const attempt = ++request.current;
      currentState.current = "starting";
      setState("starting");
      setRan(true);
      setStopped(false);
      setLength(lengthMs);
      session.current.snippet(0, lengthMs, () => {
        if (request.current !== attempt) return;
        request.current++;
        onAudible();
      });
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
