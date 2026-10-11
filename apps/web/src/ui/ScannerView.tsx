import { useEffect, useRef, useState } from "react";
import { startScanner } from "../scanner/qrScanner";

export function ScannerView({
  onPayload,
  onClose,
}: {
  onPayload: (text: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onPayload);
  latest.current = onPayload;
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    if (!video.current) return;
    startScanner(video.current, (text) => latest.current(text))
      .then((started) => {
        if (started.ok) {
          if (cancelled) started.stop();
          else stop = started.stop;
        } else if (!cancelled) setError(started.error.message);
      })
      .catch(() => {
        if (!cancelled) setError("The camera could not be started.");
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={video} className="scanner-video" playsInline muted />
      <div className="scanner-frame" aria-hidden="true" />
      <p className="scanner-error" role="alert">
        {error}
      </p>
      <button type="button" onClick={onClose}>
        Close scanner
      </button>
    </div>
  );
}
