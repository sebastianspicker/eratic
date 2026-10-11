import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ApplePreviewSession, previewTarget, SpotifyPreviewSession,
  type PreviewProgress, type PreviewSession, type PreviewState,
} from "../../playback/embeddedPreview";

export function EmbeddedPreview({ url }: { url: string }) {
  const target = previewTarget(url);
  if (!target) return null;
  return target.provider === "spotify"
    ? <SpotifyPreview key={target.id} id={target.id} />
    : <ApplePreview key={`${target.storefront}/${target.id}`} id={target.id} storefront={target.storefront} url={target.url} />;
}

const messages = (name: string): Record<PreviewState, string> => ({
  loading: `Loading ${name} preview…`,
  ready: "Preview ready. Press Play; song details stay hidden.",
  starting: "Starting preview…",
  playing: "Preview playing",
  paused: "Preview stopped",
  unavailable: "No hidden preview is available for this song. Use the QR/song link.",
  error: `The preview could not play. Retry or use the QR/song link.`,
});

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

function PreviewTransport({ session, state, progress }: {
  session: RefObject<PreviewSession | undefined>; state: PreviewState; progress: PreviewProgress;
}) {
  const busy = state === "playing" || state === "starting";
  const idle = state === "loading" || state === "error" || state === "unavailable";
  // While dragging, show the drag target and seek once on release; progress updates would fight the thumb.
  const [drag, setDrag] = useState<number>();
  const position = drag ?? Math.min(progress.position, progress.duration);
  const commit = () => {
    if (drag === undefined) return;
    session.current?.seek(drag);
    setDrag(undefined);
  };
  return (
    <div className="preview-transport">
      <div className="action-row">
        {busy
          ? <button className="primary" onClick={() => session.current?.pause()}>Pause</button>
          : <button className="primary" disabled={idle} onClick={() => session.current?.play()}>Play</button>}
        <button disabled={idle} onClick={() => session.current?.seek(Math.max(0, progress.position - 10))}>Back 10 s</button>
        <button disabled={idle} onClick={() => session.current?.restart()}>Restart</button>
      </div>
      <input type="range" aria-label="Preview position" min={0} max={progress.duration} step={1} value={position}
        disabled={idle || !(progress.duration > 0)} onChange={(event) => setDrag(Number(event.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span className="preview-time" aria-hidden="true">{clock(position)} / {clock(progress.duration)}</span>
    </div>
  );
}

const empty: PreviewProgress = { position: 0, duration: 0 };

function SpotifyPreview({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>("loading");
  const [progress, setProgress] = useState(empty);
  const [showPlayer, setShowPlayer] = useState(false);
  const mount = useRef<HTMLDivElement>(null);
  const session = useRef<PreviewSession | undefined>(undefined);
  useEffect(() => {
    if (!attempt || !mount.current) return;
    setProgress(empty);
    const current = new SpotifyPreviewSession(mount.current, id, setState, { autoplay: true, progress: setProgress });
    session.current = current;
    return () => {
      current.dispose();
      if (session.current === current) session.current = undefined;
    };
  }, [id, attempt]);
  return (
    <section className="embedded-preview" aria-label="Spotify preview">
      {!attempt ? <button className="primary" onClick={() => setAttempt(1)}>Play preview</button> : <>
        <PreviewTransport session={session} state={state} progress={progress} />
        <div className="action-row">
          {state === "error" ? <button onClick={() => setAttempt(attempt + 1)}>Retry preview</button> : null}
          <button aria-expanded={showPlayer} onClick={() => {
            if (!showPlayer && state === "error") setAttempt(attempt + 1);
            setShowPlayer(!showPlayer);
          }}>
            {showPlayer ? "Hide player" : "Show player (reveals song)"}
          </button>
        </div>
        <p role="status">{messages("Spotify")[state]}</p>
      </>}
      <div className={showPlayer ? "embed-frame" : "embed-frame concealed"}
        aria-hidden={!showPlayer} inert={!showPlayer} ref={mount} />
      <p className="preview-note">Preview via Spotify. Availability and length depend on Spotify.</p>
    </section>
  );
}

function ApplePreview({ id, storefront, url }: { id: string; storefront: string; url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>("loading");
  const [progress, setProgress] = useState(empty);
  const session = useRef<PreviewSession | undefined>(undefined);
  useEffect(() => {
    if (!attempt) return;
    setProgress(empty);
    const current = new ApplePreviewSession(id, storefront, setState, { autoplay: true, progress: setProgress });
    session.current = current;
    return () => {
      current.dispose();
      if (session.current === current) session.current = undefined;
    };
  }, [id, storefront, attempt]);
  const fallback = attempt > 0 && (state === "unavailable" || state === "error");
  return (
    <section className="embedded-preview" aria-label="Apple Music preview">
      {!attempt ? <button className="primary" onClick={() => setAttempt(1)}>Play preview</button> : <>
        <PreviewTransport session={session} state={state} progress={progress} />
        {state === "error" ? <div className="action-row"><button onClick={() => setAttempt(attempt + 1)}>Retry preview</button></div> : null}
        <p role="status">{messages("Apple Music")[state]}</p>
      </>}
      {fallback ? <AppleRevealPlayer url={url} onActivate={() => {
        session.current?.dispose();
        session.current = undefined;
      }} /> : null}
      <p className="preview-note">Preview via Apple Music. Usually 30 seconds; availability depends on Apple.</p>
    </section>
  );
}

// Fallback when no hidden preview exists: Apple's standard interactive embed.
// The host explicitly reveals it to start playback; hiding keeps audio running.
function AppleRevealPlayer({ url, onActivate }: { url: string; onActivate: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <>
      <button className="primary" aria-expanded={shown} onClick={() => {
        if (!loaded) onActivate();
        setLoaded(true); setShown(!shown);
      }}>
        {shown ? "Hide player" : "Show Apple Music player (reveals song)"}
      </button>
      {loaded ? <>
        <button onClick={() => { setLoaded(false); setShown(false); }}>Stop preview</button>
        <div className={shown ? "embed-frame" : "embed-frame concealed"} aria-hidden={!shown} inert={!shown}>
          <iframe src={url} title="Apple Music preview player" height="175" width="100%"
            allow="autoplay; encrypted-media" referrerPolicy="strict-origin" />
        </div>
      </> : null}
      <p className="preview-note">Host only: use Play inside the player, then hide it while guessing. If no preview is available, use the QR/song link.</p>
    </>
  );
}
