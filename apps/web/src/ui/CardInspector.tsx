import { useState, type FormEvent } from "react";
import type { Card, Deck } from "../core/deck";
import { CardGameFields, saveStatusText, type CardGameValues, type SaveStatus } from "./CardGameFields";
import { QRPreview } from "./QRPreview";
import { eraFor, eraStyle } from "./eras";
export function CardInspector({
  card,
  deck,
  onSave,
  onSaveGame,
}: {
  card: Card;
  deck: Deck;
  // false: changed in memory but not stored on this device.
  onSave: (value: number, source: string) => boolean;
  onSaveGame: (values: CardGameValues) => boolean;
}) {
  const [year, setYear] = useState(String(card.gameYear.value));
  const [source, setSource] = useState(card.gameYear.source);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SaveStatus>("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setSaved(onSave(Number(year), source) ? "saved" : "unstored");
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save changes.",
      );
    }
  }
  const era = eraFor(card.gameYear.value);
  return (
    <article className="inspector panel">
      <header className="era-hero" style={eraStyle(era)} data-era={era.id}>
        <div className="era-motif" aria-hidden="true" />
        <div className="era-copy">
          <p className="era-label">
            {era.label} · {era.name}
          </p>
          {/* Keyed so the year drops in again when it changes. */}
          <p className="era-year" key={card.gameYear.value}>
            {card.gameYear.value}
          </p>
          <h2 className="song-title">{card.title}</h2>
          <p className="artist">{card.artist}</p>
        </div>
      </header>
      <div className="inspector-body">
        <form onSubmit={submit}>
          <label htmlFor="game-year">Game year</label>
          <input
            id="game-year"
            type="number"
            min="1850"
            max="2100"
            step="1"
            required
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              setSaved("");
            }}
          />
          <label htmlFor="year-source">Year source</label>
          <input
            id="year-source"
            required
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setSaved("");
            }}
          />
          <div className="save-row">
            <button className="primary" type="submit">
              Save changes
            </button>
            <span className="save-status" role="status">
              {saveStatusText(saved, "Changes saved")}
            </span>
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <CardGameFields card={card} deck={deck} onSave={onSaveGame} />
        <QRPreview card={card} />
      </div>
    </article>
  );
}
