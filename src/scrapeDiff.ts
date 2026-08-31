import type { RuleInterval, ScrapeResult } from "./cron";
import {
  addDays,
  clampEnd,
  clampStart,
  friendlyTimeSpan,
  parseDate,
  shortDateStyle,
} from "./dates";

/**
 * What changed between two scrapes, in the terms the site uses.
 *
 * "Inserted new scrape result at 2026-08-31T19:41:32.431Z" says something
 * changed and nothing about what, which is the one thing worth knowing: a
 * closure appearing next Saturday and a typo fix in March read identically.
 *
 * The comparison is per-date and by effective schedule rather than by rule
 * object, because upstream regroups rules constantly — a rule split from a
 * range into single days, or reordered, is not a schedule change and must not
 * report as one.
 */

/** A rule spanning more than this is upstream nonsense, not a season. */
const MAX_RULE_DAYS = 800;

/** How the site would describe a day: "open all day", "closed from 5pm". */
export function describeIntervals(
  date: string,
  intervals: readonly RuleInterval[],
): string {
  if (intervals.length === 0) return "no intervals";
  return intervals
    .map((interval) => {
      const span = friendlyTimeSpan(
        clampStart(date, interval.start_timestamp),
        clampEnd(date, interval.end_timestamp),
      );
      const what = interval.open ? "open" : "closed";
      return interval.comment
        ? `${what} ${span} (${interval.comment})`
        : `${what} ${span}`;
    })
    .join(", ");
}

/**
 * Every date the scrape covers, mapped to its effective schedule. Dates absent
 * from the map have no rule at all, which is itself a state worth diffing:
 * that is what the missing 2026-05-18 looked like.
 */
export function scheduleByDate(result: ScrapeResult): Map<string, string> {
  const byDate = new Map<string, string>();
  for (const year of result) {
    for (const rule of year.rules) {
      const description =
        rule.type === "unknown_rules"
          ? `unrecognized rules: ${rule.rules.join(" | ")}`
          : null;
      let date = rule.start_date;
      for (let i = 0; date <= rule.end_date && i < MAX_RULE_DAYS; i++) {
        // First rule wins, matching intervalsForDate and findRuleForDate, so
        // the diff describes the day the site actually serves.
        if (!byDate.has(date)) {
          byDate.set(
            date,
            description ??
              describeIntervals(
                date,
                rule.type === "known_rules" ? rule.intervals : [],
              ),
          );
        }
        date = shortDateStyle.format(addDays(parseDate(date), 1));
      }
    }
  }
  return byDate;
}

export interface DateChange {
  /** Inclusive run of consecutive dates that changed identically. */
  readonly startDate: string;
  readonly endDate: string;
  readonly before: string | null;
  readonly after: string | null;
}

/**
 * Consecutive dates changing the same way are one entry: a week-long closure
 * is one line, not seven.
 */
export function diffScrapeResults(
  prev: ScrapeResult,
  next: ScrapeResult,
): DateChange[] {
  const before = scheduleByDate(prev);
  const after = scheduleByDate(next);
  const dates = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: DateChange[] = [];
  for (const date of dates) {
    const from = before.get(date) ?? null;
    const to = after.get(date) ?? null;
    if (from === to) continue;
    const last = changes[changes.length - 1];
    const isNextDay =
      last !== undefined &&
      shortDateStyle.format(addDays(parseDate(last.endDate), 1)) === date;
    if (
      last !== undefined &&
      isNextDay &&
      last.before === from &&
      last.after === to
    ) {
      changes[changes.length - 1] = { ...last, endDate: date };
    } else {
      changes.push({ startDate: date, endDate: date, before: from, after: to });
    }
  }
  return changes;
}

function daysInChange(change: DateChange): number {
  return (
    1 +
    Math.round(
      (Date.parse(change.endDate) - Date.parse(change.startDate)) /
        (24 * 60 * 60 * 1000),
    )
  );
}

function describeRange(change: DateChange): string {
  return change.startDate === change.endDate
    ? change.startDate
    : `${change.startDate}..${change.endDate}`;
}

/** Discord has an 1800 character budget here, so cap the listing. */
const MAX_LINES = 20;

/**
 * The #diagnostics message. Upcoming dates come first: a change to next
 * Saturday is news, and upstream backfilling last March is not, but the second
 * kind is far more numerous and would otherwise push the first off the end of
 * a truncated message.
 */
export function describeScrapeDiff(
  changes: readonly DateChange[],
  today: string,
): string {
  if (changes.length === 0) {
    return "Scrape changed but no date's schedule differs (rules regrouped upstream)";
  }
  const upcoming = changes.filter((c) => c.endDate >= today);
  const past = changes.filter((c) => c.endDate < today);
  // Counted in days rather than entries throughout, so the header does not
  // mix units — an entry can cover a week.
  const days = (cs: readonly DateChange[]) =>
    cs.reduce((n, c) => n + daysInChange(c), 0);
  const header = `Schedule changed on ${days(changes)} day(s): ${days(
    upcoming,
  )} upcoming, ${days(past)} past`;
  const lines = [...upcoming, ...past]
    .slice(0, MAX_LINES)
    .map(
      (c) =>
        `${describeRange(c)}: ${c.before ?? "(no schedule)"} → ${
          c.after ?? "(no schedule)"
        }`,
    );
  const omitted = changes.length - lines.length;
  return [
    header,
    ...lines,
    ...(omitted > 0 ? [`… and ${omitted} more`] : []),
  ].join("\n");
}
