import { describe, expect, it } from "vitest";
import { parseYear } from "./YearField";

describe("parseYear", () => {
  it("accepts four ASCII digits from 1850 to 2100, trimmed", () => {
    expect(parseYear("1990")).toBe(1990);
    expect(parseYear(" 2100 ")).toBe(2100);
    expect(parseYear("1850")).toBe(1850);
  });
  it("refuses exponents, decimals, signs, other digits and out-of-range years", () => {
    for (const value of ["1.99e3", "1990.0", "+1990", "-1990", "0x7c6", "１９９０", "199", "19900", "1849", "2101", "", "  "])
      expect(parseYear(value), value).toBeUndefined();
  });
});
