import { useState } from "react";
import type { Card, Deck } from "../../core/deck";
import type { Session } from "../../core/session";
import {
  clipLengthFor,
  clipPlaying,
  clipStartFor,
  clipText,
  PROVIDER_NAMES,
  sessionClipStart,
  useCardPlayer,
  type PlaybackProps,
} from "./playback";
import type { GameController } from "./useGame";

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
  const { start, earlier, later } = useClipStart(card, deck, session);
  const { player, exact, route, play, stop, status, error } = useCardPlayer(playback, controller);
  const how = card && route(card);
  const tier = playback.hubState.tier;
  function onPlay() {
    if (!card) return;
    setPlayed(true);
    void play(card, start, lengthMs ?? clipLengthFor(session));
  }
  return (
    <div className="card-stage">
      <MysteryCard />
      <div className="clip-controls">
        {!card ? (
          <p className="muted">This card isn't in the open deck, so it can't be played here.</p>
        ) : !player || !how ? (
          <p className="muted">Choose how to play songs on Play home to hear this card.</p>
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
                Play it yourself: {PROVIDER_NAMES[player.provider]} isn't connected, so the song opens in a new tab.
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
