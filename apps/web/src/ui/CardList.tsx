import type { Deck } from "../core/deck";
import { eraFor, eraStyle } from "./eras";
export function CardList({
  deck,
  selectedID,
  onSelect,
}: {
  deck: Deck;
  selectedID: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="card-list panel" aria-labelledby="cards-title">
      <h2 id="cards-title">Cards</h2>
      <ol>
        {deck.cards.map((card, index) => {
          const era = eraFor(card.gameYear.value);
          return (
            <li key={card.id}>
              <button
                className={`song-row ${card.id === selectedID ? "selected" : ""}`}
                aria-current={card.id === selectedID ? "true" : undefined}
                onClick={() => onSelect(card.id)}
              >
                <span className="row-number">{index + 1}</span>
                <span className="song-copy">
                  <strong>{card.title}</strong>
                  <span>{card.artist}</span>
                </span>
                <span
                  className="row-year"
                  style={eraStyle(era)}
                  title={`${era.label} · ${era.name}`}
                >
                  {card.gameYear.value}
                </span>
                <span className="visually-hidden">
                  , {era.label} {era.name}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {deck.id === "demo-deck" ? (
        <p className="muted sample-note">
          Fictional sample deck. Replace with your own songs.
        </p>
      ) : null}
    </section>
  );
}
