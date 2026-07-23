import type { KnownRules, RuleInterval, ScrapeResult } from "./cron";

export const MEMORIAL_COMMENT = "Colden Kimber Memorial Ride 💐";

export interface MemorialRide {
  readonly date: string;
  /** HH:MM inclusive start of the ride window */
  readonly start: string;
  /** HH:MM inclusive end of the ride window */
  readonly endInclusive: string;
  readonly comment: string;
}

// The 2025-09-07 ride arrived via the upstream calendar as a private-event
// closure and is special-cased in scrapeCalendar.ts (nameParser). The 2026
// ride is not a reservation — the track stays open — so we annotate the open
// interval here at read time instead. The flyer image for each date is mapped
// in static/js/tooltip.mjs.
export const MEMORIAL_RIDES: readonly MemorialRide[] = [
  {
    date: "2026-07-26",
    start: "10:00",
    endInclusive: "14:59",
    comment: MEMORIAL_COMMENT,
  },
];

function spliceRide(rule: KnownRules, ride: MemorialRide): KnownRules | null {
  const rideStart = `${ride.date} ${ride.start}`;
  const rideEnd = `${ride.date} ${ride.endInclusive}`;
  let changed = false;
  const intervals: RuleInterval[] = [];
  for (const iv of rule.intervals) {
    // Only annotate open track time; a closure (rain, private event) wins.
    if (
      !iv.open ||
      iv.end_timestamp < rideStart ||
      iv.start_timestamp > rideEnd
    ) {
      intervals.push(iv);
      continue;
    }
    changed = true;
    if (iv.start_timestamp < rideStart) {
      intervals.push({ ...iv, end_timestamp: `${ride.date} 09:59` });
    }
    intervals.push({
      ...iv,
      comment: ride.comment,
      start_timestamp:
        iv.start_timestamp < rideStart ? rideStart : iv.start_timestamp,
      end_timestamp: iv.end_timestamp > rideEnd ? rideEnd : iv.end_timestamp,
    });
    if (iv.end_timestamp > rideEnd) {
      intervals.push({ ...iv, start_timestamp: `${ride.date} 15:00` });
    }
  }
  return changed ? { ...rule, intervals } : null;
}

export function applyMemorialRides(result: ScrapeResult): ScrapeResult {
  let changed = false;
  const out = result.map((year) => {
    const rides = MEMORIAL_RIDES.filter(
      (ride) => parseInt(ride.date.split("-")[0], 10) === year.year,
    );
    if (rides.length === 0) {
      return year;
    }
    const rules = year.rules.map((rule) => {
      for (const ride of rides) {
        if (
          rule.type === "known_rules" &&
          rule.start_date <= ride.date &&
          rule.end_date >= ride.date
        ) {
          const spliced = spliceRide(rule, ride);
          if (spliced) {
            changed = true;
            return spliced;
          }
        }
      }
      return rule;
    });
    return { ...year, rules };
  });
  return changed ? out : result;
}
