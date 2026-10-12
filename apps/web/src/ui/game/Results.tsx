import { useEffect, useMemo, useState } from "react";
import { bestKind, compareBest, loadBests, recordBest } from "../../bests";
import type { Deck } from "../../core/deck";
import type { CardRef, Session } from "../../core/session";
import { cardTitle, listNames, places, playerName, reveals, type RevealInfo } from "./history";
import type { ModeUI } from "./modes/types";
import type { Summary } from "./useGame";

const describe = (deck: Deck | undefined, ref: CardRef): string => {
  const { title, artist } = deck ? cardTitle(deck, ref.cardId) : { title: `Card ${ref.cardId}`, artist: "" };
  return `${ref.year} · ${title}${artist ? ` — ${artist}` : ""}`;
};
// Who gained the most on the card (engine scores before and after), or nobody.
function scorers(info: RevealInfo, session: Session): string {
  const gains = session.players.map((player) => ({
    name: player.name,
    gain: (info.after.scores[player.id] ?? 0) - (info.before.scores[player.id] ?? 0),
  }));
  const top = Math.max(0, ...gains.map((item) => item.gain));
  if (top <= 0) return "nobody scored";
  return `${listNames(gains.filter((item) => item.gain === top).map((item) => item.name))} +${top}`;
}
function relayOutcome(info: RevealInfo): string {
  if ((info.after.timeline?.length ?? 0) > (info.before.timeline?.length ?? 0)) return "+1 card for the team";
  if ((info.after.lives ?? 0) < (info.before.lives ?? 0)) return "lost a life";
  return "no card";
}
// Who the engine says continues after a sudden-death card.
function suddenDeathResult(info: RevealInfo, session: Session): string {
  if (info.after.suddenDeath) return "still tied";
  const winner = info.after.standings[0];
  return winner?.length === 1 ? `${playerName(session, winner[0])} wins` : "decided";
}
// One line per revealed card (or set, or pair), in order, from replaying the session.
export function recapLines(session: Session, deck: Deck | undefined): string[] {
  return reveals(session).map((info) => {
    let cards: string;
    if (info.cards.length > 1 && session.mode === "imposter" && !info.suddenDeath) {
      const pair = session.actions
        .slice(0, info.index)
        .reverse()
        .find((action) => action.type === "drawPair");
      const original = pair?.type === "drawPair" ? pair[pair.original] : info.cards[0];
      cards = `Original: ${describe(deck, original)}`;
    } else if (info.cards.length > 1) {
      // A set in its right order (by year; equal years keep the set's order).
      cards = info.cards
        .map((card, index) => ({ card, index }))
        .sort((a, b) => a.card.year - b.card.year || a.index - b.index)
        .map(({ card }) => describe(deck, card))
        .join(", ");
    } else cards = info.cards[0] ? describe(deck, info.cards[0]) : "";
    if (info.suddenDeath) return `Sudden death: ${cards}: ${suddenDeathResult(info, session)}`;
    if (session.mode === "relay") return `${cards}: ${relayOutcome(info)}`;
    return `${cards}: ${scorers(info, session)}`;
  });
}

// "Best: 23" or "New best: 31!" for Relay and solo games; recorded once per session.
function PersonalBest({ session, summary }: { session: Session; summary: Summary }) {
  const kind = bestKind(session);
  const score = session.mode === "relay" ? summary.teamScore : summary.scores[session.players[0]?.id];
  // Compared once, before this game is stored, so a new best keeps saying so.
  const [result] = useState(() =>
    kind && score !== undefined ? compareBest(loadBests(), session.deckId, kind, score, session.id) : undefined,
  );
  useEffect(() => {
    if (kind && score !== undefined && result?.store) recordBest(session.deckId, kind, score, session.id);
  }, [kind, score, result, session.deckId, session.id]);
  if (!result) return null;
  return <p className="personal-best">{result.isNew ? `New best: ${result.best}!` : `Best: ${result.best}`}</p>;
}

// Final standings from the engine, with shared places as "=1", then a card-by-card recap.
export function Results({
  session,
  summary,
  ui,
  deck,
  onPlayAgain,
  onNewGame,
  onDownload,
}: {
  session: Session;
  summary: Summary;
  ui: ModeUI | undefined;
  deck?: Deck;
  onPlayAgain: () => void;
  onNewGame: () => void;
  onDownload: () => void;
}) {
  const Extra = ui?.ResultsExtra;
  const unit = session.mode === "higherLower" ? "streak" : "points";
  const recap = useMemo(() => recapLines(session, deck), [session, deck]);
  return (
    <section className="results panel" aria-labelledby="results-title">
      <h2 id="results-title">Final standings</h2>
      <ol className="standings">
        {places(summary.standings).map(({ id, place }) => (
          <li key={id}>
            <span className="place">{place}</span>
            <span className="standing-name">{playerName(session, id)}</span>
            <span className="standing-score">
              {summary.scores[id] ?? 0} {unit}
              {summary.chips ? ` (incl. ${summary.chips[id]} chips)` : ""}
            </span>
            <span className="muted">{(ui?.tieBreaks?.(summary, id) ?? []).join(" · ")}</span>
          </li>
        ))}
      </ol>
      {Extra ? <Extra session={session} summary={summary} /> : null}
      <PersonalBest session={session} summary={summary} />
      {recap.length > 0 ? (
        <details className="recap">
          <summary>Card by card</summary>
          <ol className="recap-list">
            {recap.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="action-row">
        {session.mode === "daily" ? null : (
          <button className="primary" onClick={onPlayAgain}>
            Play again
          </button>
        )}
        <button onClick={onNewGame}>New game</button>
        <button onClick={onDownload}>Download session JSON</button>
      </div>
    </section>
  );
}
