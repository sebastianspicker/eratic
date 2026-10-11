import { useEffect, useRef, useState } from "react";
import { previewTarget, SpotifyPreviewSession, type PreviewState } from "../../playback/embeddedPreview";

export function EmbeddedPreview({ url }: { url: string }) {
  const target = previewTarget(url);
  if (!target) return null;
  return target.provider === "spotify"
    ? <SpotifyPreview key={target.id} id={target.id} />
    : <ApplePreview key={target.url} url={target.url} />;
}

const messages: Record<PreviewState, string> = {
  loading: "Loading Spotify preview…",
  ready: "Preview ready. Song details stay hidden.",
  starting: "Starting preview…",
  playing: "Preview playing",
  paused: "Preview stopped",
  error: "The preview could not play. Retry, show Spotify's player, or use the QR/song link.",
};

function SpotifyPreview({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>("loading");
  const [showPlayer, setShowPlayer] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const session = useRef<SpotifyPreviewSession | undefined>(undefined);
  useEffect(() => {
    if (!attempt || !mount.current) return;
    const current = new SpotifyPreviewSession(mount.current, id, setState);
    session.current = current;
    return () => {
      current.dispose();
      if (session.current === current) session.current = undefined;
    };
  }, [id, attempt]);
  return (
    <section className="embedded-preview" aria-label="Spotify preview">
      {!attempt ? <button className="primary" onClick={() => setAttempt(1)}>Load preview</button> : <>
        <div className="action-row">
          {state === "playing" || state === "starting"
            ? <button onClick={() => session.current?.pause()}>Stop preview</button>
            : <button className="primary" disabled={state === "loading" || state === "error"}
                onClick={() => session.current?.play()}>{state === "paused" ? "Replay preview" : "Play preview"}</button>}
          {state === "error" ? <button onClick={() => setAttempt(attempt + 1)}>Retry preview</button> : null}
          <button aria-expanded={showPlayer} onClick={() => setShowPlayer(!showPlayer)}>
            {showPlayer ? "Hide player" : "Show player (reveals song)"}
          </button>
        </div>
        <p role="status">{messages[state]}</p>
      </>}
      <div className={showPlayer ? "embed-frame" : "embed-frame concealed"}
        aria-hidden={!showPlayer} inert={!showPlayer} ref={mount} />
      <p className="preview-note">Preview via Spotify. Availability and length depend on Spotify.</p>
    </section>
  );
}

// Apple exposes a standard interactive embed, not Spotify's remote-control API.
// The host explicitly reveals it to start playback; hiding keeps audio running.
function ApplePreview({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <section className="embedded-preview" aria-label="Apple Music preview">
      <button className="primary" aria-expanded={shown} onClick={() => { setLoaded(true); setShown(!shown); }}>
        {shown ? "Hide player" : "Show Apple Music preview (reveals song)"}
      </button>
      {loaded ? <>
        <button onClick={() => { setLoaded(false); setShown(false); }}>Stop preview</button>
        <div className={shown ? "embed-frame" : "embed-frame concealed"} aria-hidden={!shown} inert={!shown}>
          <iframe src={url} title="Apple Music preview player" height="175" width="100%"
            allow="autoplay; encrypted-media" referrerPolicy="strict-origin" />
        </div>
      </> : null}
      <p className="preview-note">Host only: use Play inside the player, then hide it while guessing. If no preview is available, use the QR/song link.</p>
    </section>
  );
}
