// A year with -/+ steppers, limited to the contract's 1850-2100.
export const MIN_YEAR = 1850;
export const MAX_YEAR = 2100;
const START_YEAR = 1990;

export function parseYear(value: string): number | undefined {
  const year = Number(value);
  return value.trim() !== "" && Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
    ? year
    : undefined;
}
export function YearField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  function step(by: number) {
    const current = parseYear(value) ?? START_YEAR - by;
    onChange(String(Math.min(MAX_YEAR, Math.max(MIN_YEAR, current + by))));
  }
  return (
    <div className="year-field">
      <label htmlFor={id}>{label}</label>
      <div className="year-stepper">
        <button type="button" aria-label="One year earlier" onClick={() => step(-1)}>
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_YEAR}
          max={MAX_YEAR}
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" aria-label="One year later" onClick={() => step(1)}>
          +
        </button>
      </div>
    </div>
  );
}
