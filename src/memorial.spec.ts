import { describe, it, expect } from "vitest";
import { applyMemorialRides, MEMORIAL_COMMENT } from "./memorial";
import { applyScrapePatches } from "./patches";
import type { KnownRules, ScrapeResult } from "./cron";

function openAllDay(date: string): KnownRules {
  return {
    type: "known_rules",
    text: date,
    start_date: date,
    end_date: date,
    intervals: [
      {
        open: true,
        start_timestamp: `${date} 00:00`,
        end_timestamp: `${date} 23:59`,
      },
    ],
    rules: [
      `Cycle Track Open All Day\t${date}T05:00\t\tJuly 26, 2026, 5:00 AM`,
    ],
  };
}

describe("applyMemorialRides", () => {
  it("splices the 2026-07-26 ride into an open-all-day schedule", () => {
    const result = applyMemorialRides([
      { type: "year", year: 2026, rules: [openAllDay("2026-07-26")] },
    ]);
    const rule = result[0].rules[0] as KnownRules;
    expect(rule.intervals).toEqual([
      {
        open: true,
        start_timestamp: "2026-07-26 00:00",
        end_timestamp: "2026-07-26 09:59",
      },
      {
        open: true,
        comment: MEMORIAL_COMMENT,
        start_timestamp: "2026-07-26 10:00",
        end_timestamp: "2026-07-26 14:59",
      },
      {
        open: true,
        start_timestamp: "2026-07-26 15:00",
        end_timestamp: "2026-07-26 23:59",
      },
    ]);
  });

  it("keeps the interval open (not a closure)", () => {
    const result = applyMemorialRides([
      { type: "year", year: 2026, rules: [openAllDay("2026-07-26")] },
    ]);
    const rule = result[0].rules[0] as KnownRules;
    expect(rule.intervals.every((iv) => iv.open)).toBe(true);
  });

  it("does not annotate closed time", () => {
    const date = "2026-07-26";
    const rule: KnownRules = {
      ...openAllDay(date),
      intervals: [
        {
          open: true,
          start_timestamp: `${date} 00:00`,
          end_timestamp: `${date} 13:59`,
        },
        {
          open: false,
          start_timestamp: `${date} 14:00`,
          end_timestamp: `${date} 23:59`,
        },
      ],
    };
    const result = applyMemorialRides([
      { type: "year", year: 2026, rules: [rule] },
    ]);
    const out = result[0].rules[0] as KnownRules;
    expect(out.intervals).toEqual([
      {
        open: true,
        start_timestamp: `${date} 00:00`,
        end_timestamp: `${date} 09:59`,
      },
      {
        open: true,
        comment: MEMORIAL_COMMENT,
        start_timestamp: `${date} 10:00`,
        end_timestamp: `${date} 13:59`,
      },
      {
        open: false,
        start_timestamp: `${date} 14:00`,
        end_timestamp: `${date} 23:59`,
      },
    ]);
  });

  it("returns the input unchanged when no ride date is present", () => {
    const orig: ScrapeResult = [
      { type: "year", year: 2026, rules: [openAllDay("2026-07-25")] },
    ];
    expect(applyMemorialRides(orig)).toBe(orig);
  });

  it("is applied through applyScrapePatches", () => {
    const result = applyScrapePatches(
      [{ type: "year", year: 2026, rules: [openAllDay("2026-07-26")] }],
      [],
    );
    const rule = result[0].rules[0] as KnownRules;
    expect(rule.intervals.some((iv) => iv.comment === MEMORIAL_COMMENT)).toBe(
      true,
    );
  });
});
