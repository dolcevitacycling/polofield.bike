import { getTimes } from "suncalc";
import { tzTimeFormat } from "./dates";

export const POLO_LAT = 37.76815;
export const POLO_LON = -122.4927;

export const SUN_KEYS = [
  "sunrise",
  "sunriseEnd",
  "sunset",
  "sunsetStart",
] as const;
export type SunProps = Record<(typeof SUN_KEYS)[number], string>;

export function getSunProps(date: Date): SunProps {
  const calc = getTimes(date, POLO_LAT, POLO_LON);
  return SUN_KEYS.reduce((acc, k) => {
    // suncalc 2 types these as Date | null and really does return null above
    // the polar circles, where the sun need not rise or set at all. POLO_LAT
    // is 37.77 N so that cannot happen for the Polo Field; fall back to the
    // date rather than feeding null to Intl, which silently formats it as
    // midnight (which is what the stale v1 types let us do unknowingly).
    acc[k] = tzTimeFormat.format(calc[k] ?? date);
    return acc;
  }, {} as SunProps);
}
