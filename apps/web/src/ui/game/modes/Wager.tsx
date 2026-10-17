// Stakes: 1 to 3 chips, at most the chips held (game-rules.md section 5.4).
export function Wager({
  held,
  value,
  onChange,
  playerName,
  rule,
}: {
  held: number;
  value: number;
  onChange: (chips: number) => void;
  // The player this wager is for, named for screen readers.
  playerName?: string;
  // What wins the wager in this mode, one muted line under the legend.
  rule?: string;
}) {
  const max = Math.min(3, held);
  return (
    <fieldset className="wager">
      <legend>
        Wager{playerName ? ` for ${playerName}` : ""} (holding {held} chip{held === 1 ? "" : "s"})
      </legend>
      {rule ? <p className="muted wager-rule">{rule}</p> : null}
      <div className="segmented">
        {[1, 2, 3].map((chips) => (
          <button
            key={chips}
            type="button"
            aria-label={`${chips} chip${chips === 1 ? "" : "s"}`}
            aria-pressed={held > 0 && value === chips}
            disabled={chips > max}
            onClick={() => onChange(chips)}
          >
            {chips}
          </button>
        ))}
      </div>
      {held === 0 ? <p className="muted">No chips left, so no wager on this card.</p> : null}
    </fieldset>
  );
}
