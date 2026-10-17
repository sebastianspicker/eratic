import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Deck } from "../../../core/deck";
import type { CardRef } from "../../../core/session";
import { eraFor, eraStyle } from "../../eras";
import { cardTitle } from "../history";

// A slot in words: "Before 1984", "Between 1984 and 1997", "After 1997".
export function slotLabel(years: readonly number[], slot: number): string {
  if (years.length === 0) return "First card";
  if (slot === 0) return `Before ${years[0]}`;
  if (slot === years.length) return `After ${years[years.length - 1]}`;
  return `Between ${years[slot - 1]} and ${years[slot]}`;
}

// An era-coloured year chip with the title below; an optional letter (Lineup).
export function YearChip({ card, deck, letter, isNew = false }: { card: CardRef; deck: Deck; letter?: string; isNew?: boolean }) {
  const era = eraFor(card.year);
  return (
    <span className={isNew ? "tl-chip new" : "tl-chip"} style={eraStyle(era)} data-era={era.id}>
      {letter ? <span className="tl-letter">{letter}</span> : null}
      <span className="tl-year">{card.year}</span>
      <span className="tl-title">{cardTitle(deck, card.cardId).title}</span>
      {isNew ? <span className="visually-hidden">(new)</span> : null}
    </span>
  );
}

const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
// Home and End jump to the first and last open slot.
const ENDS = new Set(["Home", "End"]);

// A timeline: year chips with a slot button before, between and after them.
// Arrow keys move between the open slots (Home and End jump to the first and last) and Enter selects one; the confirm
// button below ("Place: Before 1984") is what calls onSlot, so a stray tap never
// places a card. Without onSlot the strip only shows the chips and any marked
// slots ("Your slot").
export function TimelineStrip({
  cards,
  deck,
  label,
  compact = false,
  onSlot,
  verb = "Place",
  open = () => true,
  markers = {},
  newCardId,
}: {
  cards: readonly CardRef[];
  deck: Deck;
  label: string;
  compact?: boolean;
  onSlot?: (slot: number) => void;
  // The confirm button's verb: "Place" or "Challenge".
  verb?: string;
  open?: (slot: number) => boolean;
  markers?: Record<number, string>;
  // The card to mark as new (a reveal's strip).
  newCardId?: string;
}) {
  const years = cards.map((card) => card.year);
  const slots = Array.from({ length: cards.length + 1 }, (_, slot) => slot);
  const openSlots = onSlot ? slots.filter(open) : [];
  const [focused, setFocused] = useState(openSlots[0] ?? 0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<number>();
  const confirm = useRef<HTMLButtonElement>(null);
  const chosen = selected !== undefined && openSlots.includes(selected) ? selected : undefined;
  // Focus moves to the confirm button when a slot is selected; the page stays where the slot is.
  useEffect(() => {
    if (chosen !== undefined) confirm.current?.focus({ preventScroll: true });
  }, [chosen]);
  const tabStop = openSlots.includes(focused) ? focused : openSlots[0];
  function move(event: KeyboardEvent, slot: number) {
    const by = MOVES[event.key];
    if (by === undefined && !ENDS.has(event.key)) return;
    event.preventDefault();
    const index = by === undefined ? (event.key === "Home" ? 0 : openSlots.length - 1) : openSlots.indexOf(slot) + by;
    if (index < 0 || index >= openSlots.length) return;
    setFocused(openSlots[index]);
    buttons.current[openSlots[index]]?.focus();
  }
  function slotItem(slot: number) {
    const marker = markers[slot];
    const text = slotLabel(years, slot);
    if (onSlot && open(slot))
      return (
        <li key={`slot-${slot}`} className={slot === chosen ? "tl-slot selected" : "tl-slot"}>
          <button
            type="button"
            ref={(element) => {
              buttons.current[slot] = element;
            }}
            tabIndex={slot === tabStop ? 0 : -1}
            onFocus={() => setFocused(slot)}
            onKeyDown={(event) => move(event, slot)}
            aria-pressed={slot === chosen}
            onClick={() => setSelected(slot)}
          >
            {text}
          </button>
        </li>
      );
    if (!marker) return compact || !onSlot ? null : <li key={`slot-${slot}`} className="tl-slot tl-gap" aria-hidden="true" />;
    return (
      <li key={`slot-${slot}`} className="tl-slot tl-marked">
        <span className="tl-marker">
          {text}: {marker}
        </span>
      </li>
    );
  }
  return (
    <div className={compact ? "tl-strip compact" : "tl-strip"} role="group" aria-label={label}>
      <ol className="tl-row">
        {slots.flatMap((slot) => [
          slotItem(slot),
          slot < cards.length ? (
            <li key={cards[slot].cardId} className="tl-card">
              <YearChip card={cards[slot]} deck={deck} isNew={cards[slot].cardId === newCardId} />
            </li>
          ) : null,
        ])}
      </ol>
      {onSlot && chosen !== undefined ? (
        <div className="action-row tl-confirm sticky">
          <button type="button" className="primary" ref={confirm} onClick={() => onSlot(chosen)}>
            {verb}: {slotLabel(years, chosen)}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(undefined);
              buttons.current[chosen]?.focus();
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
