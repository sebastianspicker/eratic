import jsQR from "jsqr";

export type ScannerErrorCode =
  | "insecureContext"
  | "noCamera"
  | "denied"
  | "unavailable";
export interface ScannerError {
  code: ScannerErrorCode;
  message: string;
}
export type ScannerStart =
  | { ok: true; stop(): void }
  | { ok: false; error: ScannerError };

// Decodes one video frame to a QR payload, or undefined if none is visible.
export type FrameDecoder = (video: HTMLVideoElement) => Promise<string | undefined>;
export interface ScannerDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  decoder?: FrameDecoder;
  intervalMs?: number;
  dedupeMs?: number;
  now?: () => number;
  isSecureContext?: boolean;
}

const INTERVAL_MS = 125; // ~8 frames per second
const DEDUPE_MS = 2000;

type DetectorConstructor = new (options: { formats: string[] }) => {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};

export function barcodeDetectorDecoder(Detector: DetectorConstructor): FrameDecoder {
  const detector = new Detector({ formats: ["qr_code"] });
  return async (video) => (await detector.detect(video))[0]?.rawValue;
}

export function jsQrDecoder(): FrameDecoder {
  const canvas = document.createElement("canvas");
  return async (video) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return undefined;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(video, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return jsQR(image.data, width, height)?.data;
  };
}

// Native BarcodeDetector when the browser has it, else jsQR on canvas pixels.
export function defaultDecoder(
  host: { BarcodeDetector?: DetectorConstructor } = globalThis as object,
): FrameDecoder {
  return host.BarcodeDetector
    ? barcodeDetectorDecoder(host.BarcodeDetector)
    : jsQrDecoder();
}

function errorFor(error: unknown): ScannerError {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return { code: "denied", message: "Camera access was blocked. Allow it in the browser settings." };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return { code: "noCamera", message: "No camera was found on this device." };
  return { code: "unavailable", message: "The camera could not be started." };
}

export async function startScanner(
  video: HTMLVideoElement,
  onPayload: (text: string) => void,
  deps: ScannerDeps = {},
): Promise<ScannerStart> {
  const secure = deps.isSecureContext ?? globalThis.isSecureContext;
  if (!secure)
    return {
      ok: false,
      error: { code: "insecureContext", message: "The camera needs a secure (https) page." },
    };
  const getUserMedia =
    deps.getUserMedia ??
    (navigator.mediaDevices?.getUserMedia
      ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
      : undefined);
  if (!getUserMedia)
    return { ok: false, error: { code: "noCamera", message: "This browser has no camera access." } };
  // Build the decoder first, so a failure there never leaves the camera on.
  let decode: FrameDecoder;
  try {
    decode = deps.decoder ?? defaultDecoder();
  } catch {
    return { ok: false, error: { code: "unavailable", message: "This browser can't decode QR codes." } };
  }
  let stream: MediaStream;
  try {
    stream = await getUserMedia({ video: { facingMode: "environment" } });
  } catch (error) {
    return { ok: false, error: errorFor(error) };
  }
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  const now = deps.now ?? (() => performance.now());
  const dedupeMs = deps.dedupeMs ?? DEDUPE_MS;
  try {
    video.srcObject = stream;
  } catch (error) {
    release();
    return { ok: false, error: errorFor(error) };
  }
  try {
    await video.play();
  } catch {
    // autoplay quirks: frames still arrive once the element is visible
  }
  let stopped = false;
  let busy = false;
  let last: { text: string; at: number } | undefined;
  const timer = setInterval(async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const text = await decode(video);
      if (stopped || text === undefined || text === "") return;
      const at = now();
      if (last && last.text === text && at - last.at < dedupeMs) return;
      last = { text, at };
      onPayload(text);
    } catch {
      // a bad frame is skipped
    } finally {
      busy = false;
    }
  }, deps.intervalMs ?? INTERVAL_MS);
  return {
    ok: true,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      release();
    },
  };
}
