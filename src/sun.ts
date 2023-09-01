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
    acc[k] = tzTimeFormat.format(calc[k]);
    return acc;
  }, {} as SunProps);
}
