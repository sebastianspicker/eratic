import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE_MODULES, renderQR } from "./qrSvg";

describe("renderQR", () => {
  it("renders an SVG with a four-module quiet zone", async () => {
    expect(QR_QUIET_ZONE_MODULES).toBe(4);
    const svg = await renderQR("https://example.com/music/demo-001");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#ffffff");
    // Version 3 has 29 modules; margin contributes 8 more modules to each side.
    expect(svg).toContain('viewBox="0 0 37 37"');
  });
});
