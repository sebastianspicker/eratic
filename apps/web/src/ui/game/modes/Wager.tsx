// Stakes: 1 to 3 chips, at most the chips held (game-rules.md section 5.4).
export function Wager({
  held,
  value,
  onChange,
}: {
  held: number;
  value: number;
  onChange: (chips: number) => void;
}) {
  const max = Math.min(3, held);
  return (
    <fieldset className="wager">
      <legend>
        Wager (holding {held} chip{held === 1 ? "" : "s"})
      </legend>
      <div className="segmented">
        {[1, 2, 3].map((chips) => (
          <button
            key={chips}
            type="button"
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
