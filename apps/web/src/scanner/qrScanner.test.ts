// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { barcodeDetectorDecoder, defaultDecoder, startScanner, type ScannerDeps } from "./qrScanner";

function fakeStream() {
  const stops = [vi.fn(), vi.fn()];
  return { stream: { getTracks: () => stops.map((stop) => ({ stop })) } as unknown as MediaStream, stops };
}
function setup(texts: (string | undefined)[], over: ScannerDeps = {}) {
  const { stream, stops } = fakeStream();
  const video = document.createElement("video");
  video.play = async () => {};
  let time = 0;
  let frame = 0;
  const decoder = vi.fn(async () => {
    const value = texts[Math.min(frame, texts.length - 1)];
    frame++;
    time += 125;
    return value;
  });
  const getUserMedia = vi.fn(async () => stream);
  const payloads: string[] = [];
  const started = startScanner(video, (t) => payloads.push(t), {
    getUserMedia,
    decoder,
    isSecureContext: true,
    intervalMs: 125,
    now: () => time,
    ...over,
  });
  return { started, payloads, stops, getUserMedia, decoder, video };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startScanner", () => {
  it("asks for the rear camera and reports each new payload", async () => {
    const { started, payloads, getUserMedia } = setup(["a", "a", "b"]);
    const result = await started;
    expect(result.ok).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
    await vi.advanceTimersByTimeAsync(125 * 3);
    expect(payloads).toEqual(["a", "b"]);
  });

  it("de-duplicates the same payload within 2 s but repeats it afterwards", async () => {
    const { started, payloads } = setup(["a"]);
    await started;
    await vi.advanceTimersByTimeAsync(125 * 15); // fake time 1.9 s
    expect(payloads).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(125 * 3);
    expect(payloads).toEqual(["a", "a"]);
  });

  it("ignores empty frames", async () => {
    const { started, payloads } = setup([undefined, ""]);
    await started;
    await vi.advanceTimersByTimeAsync(500);
    expect(payloads).toEqual([]);
  });

  it("stop releases the camera and stops decoding", async () => {
    const { started, stops, decoder, video } = setup(["a"]);
    const result = await started;
    await vi.advanceTimersByTimeAsync(125);
    if (result.ok) result.stop();
    const calls = decoder.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(decoder.mock.calls.length).toBe(calls);
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("reports errors as typed results", async () => {
    const insecure = await setup(["a"], { isSecureContext: false }).started;
    expect(insecure).toMatchObject({ ok: false, error: { code: "insecureContext" } });
    for (const [name, code] of [
      ["NotAllowedError", "denied"],
      ["NotFoundError", "noCamera"],
      ["AbortError", "unavailable"],
    ] as const) {
      const failed = await setup(["a"], {
        getUserMedia: async () => {
          throw Object.assign(new Error("x"), { name });
        },
      }).started;
      expect(failed).toMatchObject({ ok: false, error: { code } });
    }
  });
});

describe("decoder selection", () => {
  it("uses BarcodeDetector for qr_code when present", async () => {
    const formats: unknown[] = [];
    class Detector {
      constructor(options: { formats: string[] }) {
        formats.push(options.formats);
      }
      async detect() {
        return [{ rawValue: "native" }];
      }
    }
    const decode = defaultDecoder({ BarcodeDetector: Detector });
    expect(await decode(document.createElement("video"))).toBe("native");
    expect(formats).toEqual([["qr_code"]]);
  });

  it("returns undefined when the detector finds nothing", async () => {
    const decode = barcodeDetectorDecoder(
      class {
        async detect() {
          return [];
        }
      },
    );
    expect(await decode(document.createElement("video"))).toBeUndefined();
  });

  it("falls back to jsQR on canvas pixels without BarcodeDetector", async () => {
    const decode = defaultDecoder({});
    // jsdom video has no frame size, so the canvas path declines before touching pixels.
    expect(await decode(document.createElement("video"))).toBeUndefined();
  });
});

describe("camera release", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never opens the camera when the decoder can't be built", async () => {
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        constructor() {
          throw new Error("unsupported");
        }
      },
    );
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    const result = await startScanner(document.createElement("video"), () => {}, {
      getUserMedia,
      isSecureContext: true,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("stops every track when the video can't take the stream", async () => {
    const { stream, stops } = fakeStream();
    const video = document.createElement("video");
    Object.defineProperty(video, "srcObject", {
      configurable: true,
      get: () => null,
      set(value) {
        if (value) throw new Error("no");
      },
    });
    const result = await startScanner(video, () => {}, {
      getUserMedia: async () => stream,
      decoder: async () => undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(false);
    for (const stop of stops) expect(stop).toHaveBeenCalled();
  });

  it("keeps scanning when play() is refused", async () => {
    const video = document.createElement("video");
    video.play = () => Promise.reject(new Error("autoplay"));
    const result = await startScanner(video, () => {}, {
      getUserMedia: async () => fakeStream().stream,
      decoder: async () => undefined,
      isSecureContext: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) result.stop();
  });
});
