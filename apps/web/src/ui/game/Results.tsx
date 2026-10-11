import type { Session } from "../../core/session";
import { places, playerName } from "./history";
import type { ModeUI } from "./modes/types";
import type { Summary } from "./useGame";

// Final standings from the engine, with shared places as "=1".
export function Results({
  session,
  summary,
  ui,
  onPlayAgain,
  onNewGame,
  onDownload,
}: {
  session: Session;
  summary: Summary;
  ui: ModeUI | undefined;
  onPlayAgain: () => void;
  onNewGame: () => void;
  onDownload: () => void;
}) {
  const Extra = ui?.ResultsExtra;
  const unit = session.mode === "higherLower" ? "streak" : "points";
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
