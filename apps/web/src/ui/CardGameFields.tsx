import { useEffect, useState, type SyntheticEvent } from "react";
import { migrateDeck, validateDeck, type Card, type Deck } from "../core/deck";

// Deck format 2's optional game fields (contract/game-rules.md section 8.3). The
// rules stay in the core: these helpers only build the deck, and validateDeck
// decides whether it is valid.
export const MIGRATION_NOTICE = "Saved as deck format 2; older Eratic versions can't open it.";
type Relation = NonNullable<Card["relatedTo"]>["relation"];
const RELATIONS: [Relation, string][] = [
  ["originalOf", "Original of"],
  ["coverOf", "Cover of"],
  ["remasterOf", "Remaster of"],
];
export interface CardGameValues {
  // Seconds as typed; empty means none.
  clipStart: string;
  difficulty: string;
  related: string;
  relation: Relation | "";
}

const ms = (seconds: string): number | undefined =>
  seconds.trim() === "" ? undefined : Math.round(Number(seconds) * 1000);
const hasGameFields = (card: Card): boolean =>
  card.clip !== undefined || card.difficulty !== undefined || card.relatedTo !== undefined;
// A version-1 deck is migrated only when a version-2 value is actually set.
function saveV2(deck: Deck, update: (deck: Deck) => Deck): { deck: Deck; migrated: boolean } {
  const draft = update(deck);
  const needsV2 = draft.defaultClipStartMs !== undefined || draft.cards.some(hasGameFields);
  if (deck.schemaVersion !== 1 || !needsV2) return { deck: validateDeck(draft), migrated: false };
  return { deck: validateDeck(update(migrateDeck(deck))), migrated: true };
}

export function withCardGameFields(
  deck: Deck,
  cardId: string,
  values: CardGameValues,
): { deck: Deck; migrated: boolean } {
  if ((values.related === "") !== (values.relation === ""))
    throw new Error("Choose both a related recording and how it relates, or neither.");
  const startMs = ms(values.clipStart);
  return saveV2(deck, (base) => ({
    ...base,
    cards: base.cards.map((card) => {
      if (card.id !== cardId) return card;
      const { clip: _clip, difficulty: _difficulty, relatedTo: _relatedTo, ...rest } = card;
      void _clip;
      void _difficulty;
      void _relatedTo;
      return {
        ...rest,
        ...(startMs !== undefined && { clip: { startMs } }),
        ...(values.difficulty !== "" && { difficulty: Number(values.difficulty) }),
        ...(values.related !== "" &&
          values.relation !== "" && { relatedTo: { cardId: values.related, relation: values.relation } }),
      };
    }),
  }));
}
// Applies one reviewed suggestion: the card's relatedTo, with the version 2 conversion.
export function withCardRelation(
  deck: Deck,
  cardId: string,
  relatedTo: NonNullable<Card["relatedTo"]>,
): { deck: Deck; migrated: boolean } {
  return saveV2(deck, (base) => ({
    ...base,
    cards: base.cards.map((card) => (card.id === cardId ? { ...card, relatedTo } : card)),
  }));
}
export function withDeckClipStart(deck: Deck, seconds: string): { deck: Deck; migrated: boolean } {
  const startMs = ms(seconds);
  return saveV2(deck, (base) => {
    const { defaultClipStartMs: _previous, ...rest } = base;
    void _previous;
    return { ...rest, ...(startMs !== undefined && { defaultClipStartMs: startMs }) };
  });
}

const secondsOf = (value: number | undefined): string => (value === undefined ? "" : String(value / 1000));
function useSaveStatus(onSave: () => void) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  function submit(event: SyntheticEvent) {
    event.preventDefault();
    try {
      onSave();
      setSaved(true);
      setError("");
    } catch (failure) {
      setSaved(false);
      setError(failure instanceof Error ? failure.message : "Could not save the game settings.");
    }
  }
  return { error, saved, submit, edited: () => setSaved(false) };
}

// The inspector's optional Game section: clip start, difficulty, related recording.
export function CardGameFields({
  card,
  deck,
  onSave,
}: {
  card: Card;
  deck: Deck;
  onSave: (values: CardGameValues) => void;
}) {
  const [values, setValues] = useState<CardGameValues>({
    clipStart: secondsOf(card.clip?.startMs),
    difficulty: card.difficulty === undefined ? "" : String(card.difficulty),
    related: card.relatedTo?.cardId ?? "",
    relation: card.relatedTo?.relation ?? "",
  });
  const { error, saved, submit, edited } = useSaveStatus(() => onSave(values));
  // A link applied elsewhere (suggestions) changes the saved relation: re-read it
  // without losing the other fields' unsaved edits.
  const savedRelated = card.relatedTo?.cardId ?? "";
  const savedRelation = card.relatedTo?.relation ?? "";
  useEffect(() => {
    setValues((current) =>
      current.related === savedRelated && current.relation === savedRelation
        ? current
        : { ...current, related: savedRelated, relation: savedRelation },
    );
  }, [savedRelated, savedRelation]);
  function change(patch: Partial<CardGameValues>) {
    setValues((current) => ({ ...current, ...patch }));
    edited();
  }
  return (
    <form className="game-fields" onSubmit={submit} noValidate>
      <h2>Game</h2>
      <p className="muted">Optional. Setting any of these saves the deck in format 2.</p>
      <label htmlFor="clip-start">Clip start (seconds)</label>
      <input
        id="clip-start"
        type="number"
        min="0"
        max="3600"
        step="any"
        value={values.clipStart}
        onChange={(event) => change({ clipStart: event.target.value })}
      />
      <label htmlFor="difficulty">Difficulty</label>
      <select id="difficulty" value={values.difficulty} onChange={(event) => change({ difficulty: event.target.value })}>
        <option value="">None</option>
        {[1, 2, 3, 4, 5].map((level) => (
          <option key={level} value={String(level)}>
            {level}
            {level <= 2 ? " (easy)" : ""}
          </option>
        ))}
      </select>
      <label htmlFor="relation">This recording is the</label>
      <select
        id="relation"
        value={values.relation}
        onChange={(event) => change({ relation: event.target.value as CardGameValues["relation"] })}
      >
        <option value="">None</option>
        {RELATIONS.map(([relation, label]) => (
          <option key={relation} value={relation}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="related-card">Related recording</label>
      <select id="related-card" value={values.related} onChange={(event) => change({ related: event.target.value })}>
        <option value="">None</option>
        {deck.cards
          .filter((other) => other.id !== card.id)
          .map((other) => (
            <option key={other.id} value={other.id}>
              {other.title} · {other.artist}
            </option>
          ))}
      </select>
      <div className="save-row">
        <button type="submit">Save game settings</button>
        <span className="save-status" role="status">
          {saved ? "Game settings saved" : ""}
        </span>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// The deck's default clip start, shown under the deck heading. Not a form, so the
// inspector's form stays the page's first.
export function DeckGameFields({ deck, onSave }: { deck: Deck; onSave: (seconds: string) => void }) {
  const [value, setValue] = useState(secondsOf(deck.defaultClipStartMs));
  const { error, saved, submit, edited } = useSaveStatus(() => onSave(value));
  return (
    <div className="deck-game-fields" role="group" aria-label="Deck game settings">
      <label htmlFor="default-clip-start">Default clip start (seconds)</label>
      <div className="player-input">
        <input
          id="default-clip-start"
          type="number"
          min="0"
          max="3600"
          step="any"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            edited();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(event);
          }}
        />
        <button type="button" onClick={submit}>
          Save default
        </button>
      </div>
      <span className="save-status" role="status">
        {saved ? "Default saved" : ""}
      </span>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
