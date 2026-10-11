import { useEffect, useState } from "react";
import type { Card } from "../core/deck";
import { qrPayload } from "../core/cardUrls";
import { renderQR } from "../qrSvg";
const providerNames = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  youtube: "YouTube",
  other: "Other",
};
export function QRPreview({ card }: { card: Card }) {
  const [direct, setDirect] = useState(false);
  const [linkIndex, setLinkIndex] = useState(0);
  const [rendered, setRendered] = useState<{ payload: string; svg: string }>();
  const [failedPayload, setFailedPayload] = useState<string>();
  const payload = qrPayload(card, direct ? "directLink" : "official", linkIndex);
  useEffect(() => {
    let active = true;
    if (payload)
      void renderQR(payload).then(
        (svg) => {
          if (active) setRendered({ payload, svg });
        },
        () => {
          if (active) setFailedPayload(payload);
        },
      );
    return () => {
      active = false;
    };
  }, [payload]);
  const ready = payload && rendered?.payload === payload;
  return (
    <section className="qr-section" aria-labelledby="qr-title">
      <h2 id="qr-title">QR preview</h2>
      <label className="visually-hidden" htmlFor="qr-destination">
        QR destination
      </label>
      <select
        id="qr-destination"
        value={direct ? String(linkIndex) : "official"}
        disabled={!direct}
        onChange={(event) => setLinkIndex(Number(event.target.value))}
      >
        {direct ? (
          card.links.map((link, index) => (
            <option key={index} value={index}>
              {providerNames[link.provider]}
              {card.links.filter((item) => item.provider === link.provider)
                .length > 1
                ? ` · ${index + 1}`
                : ""}
            </option>
          ))
        ) : (
          <option value="official">Official card</option>
        )}
        {direct && card.links.length === 0 ? (
          <option value="0">No provider links</option>
        ) : null}
      </select>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={direct}
          onChange={(event) => {
            setDirect(event.target.checked);
            setLinkIndex(0);
          }}
        />
        Use a direct provider link instead
      </label>
      <div className="qr-preview" aria-live="polite">
        {ready ? (
          <div
            className="qr-image"
            role="img"
            aria-label={`QR code containing ${payload}`}
            dangerouslySetInnerHTML={{ __html: rendered.svg }}
          />
        ) : (
          <div className="qr-empty">
            <strong>
              {payload
                ? failedPayload === payload
                  ? "QR could not be generated"
                  : "Generating QR…"
                : direct
                  ? "No provider link"
                  : "No official card mapping"}
            </strong>
            <span>
              {!payload
                ? direct
                  ? "Import a deck containing a provider URL."
                  : "Add a known official card URL to this song."
                : null}
            </span>
          </div>
        )}
      </div>
      {payload ? <p className="payload">{payload}</p> : null}
      {!direct && payload ? (
        <p className="muted">
          Supplied official URL. Playback has not been verified.
        </p>
      ) : null}
      <p className="muted compatibility-note">
        Direct links open the provider. They are not compatible with the
        official Hitster app.
      </p>
    </section>
  );
}
