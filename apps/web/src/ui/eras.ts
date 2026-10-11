import type { CSSProperties } from "react";
import tokens from "../../../../design/eras.json";
import bounds from "../../../../contract/eras.json";
import { eraOf } from "../core/eras";

// Presentation only: the curated year picks a style; it never changes deck data.
export interface Era {
  id: string;
  name: string;
  label: string;
  from: number | null;
  to: number | null;
  ground: string;
  ink: string;
  accent: string;
  onAccent: string;
  glow: string;
  type: {
    width: number;
    weight: number;
    case: "upper" | "lower" | "none";
    tracking: number;
    tilt: number;
    glow: boolean;
  };
}
type Tokens = Omit<Era, "name" | "from" | "to">;
// Boundaries and names come from contract/eras.json, presentation from design/eras.json.
export const ERAS: Era[] = (tokens.eras as Tokens[]).map((token) => {
  const found = bounds.eras.find((era) => era.id === token.id);
  if (!found) throw new Error(`Era ${token.id} is missing from contract/eras.json.`);
  return { ...token, name: found.name, from: found.from, to: found.to };
});

export function eraFor(year: number): Era {
  const id = eraOf(year);
  return ERAS.find((era) => era.id === id) ?? ERAS[ERAS.length - 1];
}

// Each era's pattern is built only from stripes, dots and rings.
const MOTIFS: Record<string, string> = {
  shellac:
    "repeating-conic-gradient(from 270deg at 50% 100%, #EDE3CC 0deg 5deg, #C9B48C 5deg 6deg)",
  jukebox:
    "radial-gradient(#D3362A 22%, transparent 24%) 0 0 / 26px 26px, #FDF0E0",
  mod: "repeating-radial-gradient(circle at 88% 50%, #C2410C 0 12px, #F6F2E8 12px 22px, #141414 22px 27px, #F6F2E8 27px 38px)",
  disco:
    "repeating-linear-gradient(180deg, #F3A63B 0 8px, #2B1330 8px 14px, #E2648E 14px 20px, #2B1330 20px 28px)",
  neon: "linear-gradient(rgba(255,63,164,0.65) 1px, transparent 1px) 0 0 / 100% 16px, linear-gradient(90deg, rgba(34,211,238,0.5) 1px, transparent 1px) 0 0 / 28px 100%, #0D0A1E",
  zine: "radial-gradient(#121212 28%, transparent 31%) 0 0 / 9px 9px, radial-gradient(#2F3BD9 28%, transparent 31%) 4px 4px / 9px 9px, #E6E5DF",
  chrome: "repeating-linear-gradient(180deg, #E6EEF5 0 3px, #C3D2DF 3px 4px)",
  pastel:
    "radial-gradient(circle at 18% 150%, #F2C1CF 0 60%, transparent 60.5%), radial-gradient(circle at 90% -40%, #D8CDF4 0 50%, transparent 50.5%), #FBEFF1",
  now: "radial-gradient(#B7FF3C 1.6px, transparent 2.2px) 0 0 / 18px 18px, #111111",
};

// Custom properties consumed by styles.css (.era-*, .row-year, .wordmark-era).
export function eraStyle(era: Era): CSSProperties {
  return {
    "--era-ground": era.ground,
    "--era-ink": era.ink,
    "--era-accent": era.accent,
    "--era-on-accent": era.onAccent,
    "--era-glow": era.glow,
    "--era-motif": MOTIFS[era.id],
    "--era-width": `${era.type.width}%`,
    "--era-weight": era.type.weight,
    "--era-case":
      era.type.case === "upper"
        ? "uppercase"
        : era.type.case === "lower"
          ? "lowercase"
          : "none",
    "--era-tracking": `${era.type.tracking}em`,
    "--era-tilt": `${era.type.tilt}deg`,
    "--era-halo": era.type.glow ? `0 0 18px ${era.glow}99` : "none",
  } as CSSProperties;
}
export const motifFor = (era: Era): string => MOTIFS[era.id];
