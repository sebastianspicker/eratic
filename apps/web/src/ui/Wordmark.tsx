import { eraStyle, type Era } from "./eras";

// "era" dances in the current card's decade; "tic" keeps time. The dot of the i
// is a QR finder square (drawn in CSS), so the cards are in the mark.
export function Wordmark({ era }: { era: Era }) {
  return (
    <span
      className="wordmark"
      role="img"
      aria-label="Eratic"
      style={eraStyle(era)}
    >
      <span className="wordmark-era" key={era.id}>
        era
      </span>
      <span className="wordmark-tic">
        t<span className="wordmark-i">ı</span>c
      </span>
    </span>
  );
}
