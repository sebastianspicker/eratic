import type { Deck } from "../../core/deck";
import { distance } from "../../core/scoring";
import type { CardRef, Session } from "../../core/session";
import { eraFor, eraStyle } from "../eras";
import { cardTitle, listNames, playerName, type RevealInfo } from "./history";
import { orderText, RightOrder } from "./modes/Lineup";
import type { ModeUI, ResultLine } from "./modes/types";

const yearsOff = (n: number): string => (n === 0 ? "exact" : `${n} year${n === 1 ? "" : "s"} off`);

function suddenDeathLines(info: RevealInfo): ResultLine[] {
  const answer = info.cards[0]?.year;
  return info.inputs.flatMap((action): ResultLine[] => {
    if (action.type === "sdGuess")
      return [{ playerId: action.playerId, text: `guessed ${action.year}, ${yearsOff(distance(action.year, answer))}` }];
    if (action.type === "sdOrder")
      return [{ playerId: action.playerId, text: `ordered ${orderText(action.order, info.cards)}` }];
    if (action.type === "sdName" && action.playerId !== undefined)
      return [{ playerId: action.playerId, text: "named it first" }];
    return [];
  });
}
// Who the engine says continues after a sudden-death reveal.
function suddenDeathOutcome(info: RevealInfo, session: Session): string {
  const nobody = info.inputs.some((action) => action.type === "sdName" && action.playerId === undefined);
  const still = info.after.suddenDeath?.players;
  if (still)
    return `${nobody ? "Nobody named it. " : ""}Still tied: ${listNames(still.map((id) => playerName(session, id)))}. Draw again.`;
  const winner = info.after.standings[0]?.[0];
  return winner ? `${playerName(session, winner)} wins the sudden death.` : "";
}
function heroOf(info: RevealInfo, session: Session, ui: ModeUI | undefined): CardRef | undefined {
  if (info.suddenDeath) return info.cards.length === 1 ? info.cards[0] : undefined;
  return ui?.heroCard ? ui.heroCard(info, session) : info.cards[0];
}

// The signature moment: the card's era takes over the stage and the year drops in,
// then the title, artist and each player's result. Several cards (a lineup) are
// revealed as their right order instead.
export function Reveal({
  info,
  session,
  deck,
  ui,
  finished,
  onNext,
}: {
  info: RevealInfo;
  session: Session;
  deck: Deck;
  ui: ModeUI | undefined;
  finished: boolean;
  onNext: () => void;
}) {
  if (info.cards.length === 0) return null;
  const card = heroOf(info, session, ui);
  const lines = info.suddenDeath ? suddenDeathLines(info) : (ui?.resultLines(info, session) ?? []);
  const Extra = info.suddenDeath ? undefined : ui?.RevealExtra;
  let hero = null;
  if (card) {
    const era = eraFor(card.year);
    const { title, artist } = cardTitle(deck, card.cardId);
    hero = (
      <div className="era-hero reveal-hero" style={eraStyle(era)} data-era={era.id}>
        <div className="era-motif" aria-hidden="true" />
        <div className="era-copy">
          <p className="era-label">
            {era.label} · {era.name}
          </p>
          <p className="era-year" key={card.cardId}>
            {card.year}
          </p>
          <h2 className="song-title" tabIndex={-1} aria-describedby="reveal-summary">
            {title}
          </h2>
          <p className="artist">{artist}</p>
        </div>
      </div>
    );
  }
  // One line for screen readers, read with the focused title: "1984 · Neon. Ada +7, exact."
  const summaryLine = card
    ? [`${card.year} · ${eraFor(card.year).name}.`, ...lines.map((line) => `${playerName(session, line.playerId)} ${line.text}.`)].join(" ")
    : "";
  return (
    <section className="reveal panel" aria-label="Reveal">
      {card ? (
        <p id="reveal-summary" className="visually-hidden">
          {summaryLine}
        </p>
      ) : null}
      {hero}
      <div className="reveal-body">
        {info.suddenDeath && !card ? <RightOrder cards={info.cards} deck={deck} /> : null}
        {lines.length > 0 ? (
          <ul className="result-lines" aria-label="Results">
            {lines.map((line) => (
              <li key={line.playerId}>
                <strong>{playerName(session, line.playerId)}</strong> {line.text}
              </li>
            ))}
          </ul>
        ) : null}
        {info.suddenDeath ? <p className="reveal-note">{suddenDeathOutcome(info, session)}</p> : null}
        {Extra ? <Extra info={info} session={session} deck={deck} /> : null}
        {finished ? null : (
          <div className="action-row">
            <button className="primary" onClick={onNext}>
              Next card
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
