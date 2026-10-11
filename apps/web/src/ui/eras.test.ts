import { describe, expect, it } from "vitest";
import bounds from "../../../../contract/eras.json";
import tokens from "../../../../design/eras.json";
import { ERAS, eraFor, motifFor } from "./eras";

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const STAGE = "#17131C";

describe("era tokens", () => {
  // Both apps parse these: Swift Color(hex:) takes #RRGGBB only, and the font's axes are
  // weight 200-800 and width 75-100%.
  it.each(ERAS.map((era) => [era.id, era] as const))(
    "%s tokens are well-formed",
    (_, era) => {
      for (const colour of [
        era.ground,
        era.ink,
        era.accent,
        era.onAccent,
        era.glow,
      ])
        expect(colour).toMatch(/^#[0-9A-F]{6}$/i);
      expect(era.type.width).toBeGreaterThanOrEqual(75);
      expect(era.type.width).toBeLessThanOrEqual(100);
      expect(era.type.weight).toBeGreaterThanOrEqual(300);
      expect(era.type.weight).toBeLessThanOrEqual(800);
      expect(["upper", "lower", "none"]).toContain(era.type.case);
    },
  );
  it("list the same IDs in the same order as contract/eras.json", () => {
    expect(tokens.eras.map((era) => era.id)).toEqual(
      bounds.eras.map((era) => era.id),
    );
    expect(ERAS.map((era) => era.id)).toEqual(bounds.eras.map((era) => era.id));
  });
  it("cover every contract year exactly once, in order", () => {
    expect(ERAS).toHaveLength(9);
    expect(ERAS[0].from).toBeNull();
    expect(ERAS.at(-1)?.to).toBeNull();
    for (let i = 1; i < ERAS.length; i++)
      expect(ERAS[i].from).toBe((ERAS[i - 1].to ?? NaN) + 1);
    for (let year = 1850; year <= 2100; year++)
      expect(
        ERAS.filter(
          (era) =>
            (era.from === null || year >= era.from) &&
            (era.to === null || year <= era.to),
        ),
      ).toHaveLength(1);
  });
  it.each([
    [1850, "shellac"],
    [1949, "shellac"],
    [1950, "jukebox"],
    [1984, "neon"],
    [1997, "zine"],
    [2019, "pastel"],
    [2020, "now"],
    [2100, "now"],
  ])("places %i in %s", (year, id) => expect(eraFor(year).id).toBe(id));
  it.each(ERAS.map((era) => [era.id, era] as const))(
    "%s is readable and has a pattern",
    (_, era) => {
      expect(contrast(era.ink, era.ground)).toBeGreaterThanOrEqual(7);
      // The year is display-size text: 3:1 is the large-text minimum.
      expect(contrast(era.accent, era.ground)).toBeGreaterThanOrEqual(3);
      expect(contrast(era.onAccent, era.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(era.glow, STAGE)).toBeGreaterThanOrEqual(4.5);
      expect(motifFor(era)).toBeTruthy();
    },
  );
});
