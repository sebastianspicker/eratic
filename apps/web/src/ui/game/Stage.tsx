import { useEffect, useState } from "react";
import type { Card, Deck } from "../../core/deck";
import type { CardRef, Session } from "../../core/session";
import type { PlaybackProvider } from "../../playback/player";
import { renderQR } from "../../qrSvg";
import {
  clipLengthFor,
  clipPlaying,
  clipStartFor,
  clipText,
  backupTrack,
  PROVIDER_NAMES,
  sessionClipStart,
  useCardPlayer,
  type PlaybackProps,
} from "./playback";
import type { GameController } from "./useGame";
import { EmbeddedPreview } from "./EmbeddedPreview";

const formatTime = (ms: number): string =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// Clip start for the card in play, with the host's ±5 s nudge for this card.
export function useClipStart(card: Card | undefined, deck: Deck, session: Session) {
  const [nudge, setNudge] = useState(0);
  const start = Math.max(0, (card ? clipStartFor(card, deck, sessionClipStart(session)) : 0) + nudge);
  return {
    start,
    earlier: () => setNudge((value) => Math.max(value - 5000, value - start)),
    later: () => setNudge((value) => value + 5000),
  };
}
export function Nudge({ start, onEarlier, onLater }: { start: number; onEarlier: () => void; onLater: () => void }) {
  return (
    <div className="nudge" role="group" aria-label="Clip start">
      <button aria-label="Start 5 seconds earlier" disabled={start === 0} onClick={onEarlier}>
        −5 s
      </button>
      <span>Starts at {formatTime(start)}</span>
      <button aria-label="Start 5 seconds later" onClick={onLater}>
        +5 s
      </button>
    </div>
  );
}
// What screen readers hear: the clip's start and end, not every second.
function clipAnnouncement(playback: PlaybackProps, status: string): string {
  const { state } = playback.clipState;
  if (state === "starting") return "Starting the clip…";
  if (state === "playing") return "Clip playing";
  if (state === "finished") return "Clip finished";
  return status;
}
// The playing dot and the countdown in text, then any playback error. The
// countdown is visual; a status line announces only the clip's transitions.
export function ClipStatus({
  playback,
  status,
  error,
}: {
  playback: PlaybackProps;
  status: string;
  error: string;
}) {
  return (
    <>
      <p className="clip-status" aria-hidden="true">
        {clipPlaying(playback.clipState) ? <span className="clip-dot" /> : null}
        {clipText(playback.clipState, status)}
      </p>
      <p className="visually-hidden" role="status">
        {clipAnnouncement(playback, status)}
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
export function MysteryCard({ label = "Mystery card", small = false }: { label?: string; small?: boolean }) {
  return (
    <div className={small ? "mystery-card small" : "mystery-card"}>
      <span className="mystery-mark" aria-hidden="true">
        ?
      </span>
      <span>{label}</span>
    </div>
  );
}

// Without exact clips, the song's link as a QR: a player scans it and starts the
// song on their own phone, so the title never shows on the shared screen.
function SongQR({ url }: { url: string }) {
  const [rendered, setRendered] = useState<{ url: string; svg?: string }>();
  useEffect(() => {
    let active = true;
    void renderQR(url).then(
      (svg) => {
        if (active) setRendered({ url, svg });
      },
      () => {
        if (active) setRendered({ url });
      },
    );
    return () => {
      active = false;
    };
  }, [url]);
  const current = rendered?.url === url ? rendered : undefined;
  return (
    <figure className="song-qr">
      <div className="qr-preview">
        {current?.svg ? (
          <div
            className="qr-image"
            role="img"
            aria-label="QR code for this song"
            dangerouslySetInnerHTML={{ __html: current.svg }}
          />
        ) : current ? (
          <p className="qr-empty">The QR code could not be drawn.</p>
        ) : null}
      </div>
      <figcaption>Scan with a phone to play the song there.</figcaption>
    </figure>
  );
}

// The backup for every card in play, whatever the provider or tier: the song's
// QR and the hidden in-page preview. Collapsed when exact clips are the main route.
export function SongBackup({
  card,
  provider,
  collapsed,
  previewKey,
}: {
  card: Card;
  provider: PlaybackProvider | undefined;
  collapsed: boolean;
  previewKey?: string | number;
}) {
  const url = backupTrack(card, provider)?.url;
  if (!url) return null;
  const body = (
    <>
      <SongQR url={url} />
      <EmbeddedPreview key={previewKey} url={url} />
    </>
  );
  return collapsed ? (
    <details className="song-backup">
      <summary>Backup: song QR and hidden preview</summary>
      {body}
    </details>
  ) : (
    <div className="song-backup">{body}</div>
  );
}
// One selected card's backup at a time (Lineup, Imposter): letters A, B, … pick the
// card; switching remounts the backup so the previous preview is disposed.
export function BackupPicker({
  cards,
  deck,
  provider,
  collapsed,
  previewKey,
}: {
  cards: readonly CardRef[];
  deck: Deck;
  provider: PlaybackProvider | undefined;
  collapsed: boolean;
  previewKey?: string | number;
}) {
  const [picked, setPicked] = useState<string>();
  const open = cards.flatMap((ref, index) => {
    const card = deck.cards.find((item) => item.id === ref.cardId);
    return card ? [{ card, letter: String.fromCharCode(65 + index) }] : [];
  });
  const selected = open.find((item) => item.card.id === picked) ?? open[0];
  if (!selected) return null;
  return (
    <div className="backup-picker">
      <div className="segmented" role="group" aria-label="Backup for song">
        {open.map(({ card, letter }) => (
          <button
            key={card.id}
            type="button"
            aria-pressed={card.id === selected.card.id}
            onClick={() => setPicked(card.id)}
          >
            {letter}
          </button>
        ))}
      </div>
      <SongBackup
        key={selected.card.id}
        card={selected.card}
        provider={provider}
        collapsed={collapsed}
        previewKey={previewKey}
      />
    </div>
  );
}

// The mystery card, Play/Replay through the clip controller, and the clip-start nudge.
// lengthMs overrides the session's clip length (the 5 s sudden-death clip).
export function CardStage({
  card,
  deck,
  session,
  playback,
  controller,
  lengthMs,
}: {
  card: Card | undefined;
  deck: Deck;
  session: Session;
  playback: PlaybackProps;
  controller: GameController;
  lengthMs?: number;
}) {
  const [played, setPlayed] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const { start, earlier, later } = useClipStart(card, deck, session);
  const { player, exact, route, play, stop, status, error } = useCardPlayer(playback, controller);
  const how = card && route(card);
  const tier = playback.hubState.tier;
  function onPlay() {
    if (!card) return;
    setPlayed(true);
    setPreviewRevision(value => value + 1);
    void play(card, start, lengthMs ?? clipLengthFor(session));
  }
  return (
    <div className="card-stage">
      <MysteryCard />
      {card ? (
        <SongBackup card={card} provider={player?.provider} collapsed={how?.kind === "exact"} previewKey={previewRevision} />
      ) : null}
      <div className="clip-controls">
        {!card ? (
          <p className="muted">This card isn't in the open deck, so it can't be played here.</p>
        ) : !player || !how ? (
          <p className="muted">Use the preview or QR, or choose how to play songs on Play home.</p>
        ) : how.kind === "none" ? (
          <p className="muted">{how.message}</p>
        ) : how.kind === "exact" ? (
          <div className="action-row">
            <button className="primary" onClick={onPlay}>
              {played ? "Replay" : "Play"}
            </button>
            {clipPlaying(playback.clipState) ? <button onClick={stop}>Stop</button> : null}
          </div>
        ) : (
          <>
            {tier?.kind === "unavailable" ? (
              <p className="muted">
                Play it yourself: {PROVIDER_NAMES[player.provider]} isn't connected, so scan the code or open the song in a new tab.
              </p>
            ) : null}
            <div className="action-row">
              <button className="primary" onClick={onPlay}>
                {how.label}
              </button>
            </div>
          </>
        )}
        {exact ? <Nudge start={start} onEarlier={earlier} onLater={later} /> : null}
        <ClipStatus playback={playback} status={status} error={error} />
      </div>
    </div>
  );
}
