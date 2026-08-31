import { describe, it, expect } from "vitest";
import type { KnownRules, ScrapeResult, UnknownRules } from "./cron";
import {
  describeIntervals,
  describeScrapeDiff,
  diffScrapeResults,
  scheduleByDate,
} from "./scrapeDiff";

const openAllDay = (date: string, comment?: string): KnownRules => ({
  type: "known_rules",
  text: date,
  start_date: date,
  end_date: date,
  rules: [`Cycle Track Open\t${date}T05:00:00`],
  intervals: [
    {
      open: true,
      start_timestamp: `${date} 00:00`,
      end_timestamp: `${date} 23:59`,
      ...(comment ? { comment } : {}),
    },
  ],
});

const closedMidday = (date: string, comment?: string): KnownRules => ({
  type: "known_rules",
  text: date,
  start_date: date,
  end_date: date,
  rules: [`Cycle Track Open Until 12:30 PM\t${date}T05:00:00`],
  intervals: [
    {
      open: true,
      start_timestamp: `${date} 00:00`,
      end_timestamp: `${date} 12:29`,
    },
    {
      open: false,
      start_timestamp: `${date} 12:30`,
      end_timestamp: `${date} 17:29`,
      ...(comment ? { comment } : {}),
    },
    {
      open: true,
      start_timestamp: `${date} 17:30`,
      end_timestamp: `${date} 23:59`,
    },
  ],
});

const unknown = (date: string, ...rules: string[]): UnknownRules => ({
  type: "unknown_rules",
  text: date,
  start_date: date,
  end_date: date,
  rules,
});

const year = (...rules: (KnownRules | UnknownRules)[]): ScrapeResult => [
  { type: "year", year: 2026, rules },
];

describe("describeIntervals", () => {
  it("describes a day the way the site does", () => {
    expect(
      describeIntervals("2026-09-05", openAllDay("2026-09-05").intervals),
    ).toBe("open all day");
    expect(
      describeIntervals("2026-09-05", closedMidday("2026-09-05").intervals),
    ).toBe(
      "open until 12:30pm, closed from 12:30pm to 5:30pm, open from 5:30pm",
    );
  });

  it("keeps the reason, which is usually the point of the change", () => {
    expect(
      describeIntervals(
        "2026-09-05",
        closedMidday("2026-09-05", "Special Event").intervals,
      ),
    ).toContain("(Special Event)");
  });
});

describe("diffScrapeResults", () => {
  it("says nothing when upstream regroups rules without changing a schedule", () => {
    // The case that makes rule-object comparison useless: one range rule split
    // into per-day rules describes exactly the same three days.
    const ranged: ScrapeResult = year({
      ...openAllDay("2026-09-05"),
      end_date: "2026-09-07",
    });
    const split = year(
      openAllDay("2026-09-05"),
      openAllDay("2026-09-06"),
      openAllDay("2026-09-07"),
    );
    expect(diffScrapeResults(ranged, split)).toEqual([]);
  });

  it("reports a closure appearing, with what it replaced", () => {
    const changes = diffScrapeResults(
      year(openAllDay("2026-09-05")),
      year(closedMidday("2026-09-05", "Special Event")),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBe("open all day");
    expect(changes[0].after).toContain("Special Event");
  });

  it("collapses a run of identically changed days into one entry", () => {
    const before = year(
      openAllDay("2026-09-05"),
      openAllDay("2026-09-06"),
      openAllDay("2026-09-07"),
    );
    const after = year(
      closedMidday("2026-09-05"),
      closedMidday("2026-09-06"),
      closedMidday("2026-09-07"),
    );
    expect(diffScrapeResults(before, after)).toMatchObject([
      { startDate: "2026-09-05", endDate: "2026-09-07" },
    ]);
  });

  it("does not merge across a gap in the dates", () => {
    const before = year(openAllDay("2026-09-05"), openAllDay("2026-09-09"));
    const after = year(closedMidday("2026-09-05"), closedMidday("2026-09-09"));
    expect(diffScrapeResults(before, after)).toHaveLength(2);
  });

  it("reports a date gaining and losing a schedule entirely", () => {
    const appeared = diffScrapeResults(year(), year(openAllDay("2026-05-18")));
    expect(appeared).toMatchObject([
      { startDate: "2026-05-18", before: null, after: "open all day" },
    ]);
    const vanished = diffScrapeResults(year(openAllDay("2026-05-18")), year());
    expect(vanished).toMatchObject([{ after: null }]);
  });

  it("reports a day that stopped parsing", () => {
    const changes = diffScrapeResults(
      year(openAllDay("2026-09-05")),
      year(unknown("2026-09-05", "Cycle Track Until 11:00 AM")),
    );
    expect(changes[0].after).toBe(
      "unrecognized rules: Cycle Track Until 11:00 AM",
    );
  });

  it("expands a range rule so a change inside it is found", () => {
    const before = year({
      ...openAllDay("2026-09-05"),
      end_date: "2026-09-30",
    });
    const after = year(closedMidday("2026-09-20"), {
      ...openAllDay("2026-09-05"),
      end_date: "2026-09-30",
    });
    expect(diffScrapeResults(before, after)).toMatchObject([
      { startDate: "2026-09-20", endDate: "2026-09-20" },
    ]);
  });
});

describe("scheduleByDate", () => {
  it("takes the first rule for a date, as the site does", () => {
    // applyScrapePatches prepends the patch, and intervalsForDate returns the
    // first match; the diff has to agree or it reports phantom changes.
    const result = year(openAllDay("2026-05-18"), closedMidday("2026-05-18"));
    expect(scheduleByDate(result).get("2026-05-18")).toBe("open all day");
  });
});

describe("describeScrapeDiff", () => {
  const today = "2026-09-01";

  it("puts upcoming changes above a backfill of the past", () => {
    const changes = diffScrapeResults(
      year(openAllDay("2026-03-02"), openAllDay("2026-09-05")),
      year(closedMidday("2026-03-02"), closedMidday("2026-09-05")),
    );
    const lines = describeScrapeDiff(changes, today).split("\n");
    expect(lines[0]).toBe("Schedule changed on 2 day(s): 1 upcoming, 1 past");
    expect(lines[1]).toContain("2026-09-05");
    expect(lines[2]).toContain("2026-03-02");
  });

  it("counts the header in days, not entries, when a range collapses", () => {
    const dates = ["2026-09-05", "2026-09-06", "2026-09-07"];
    const changes = diffScrapeResults(
      year(...dates.map((d) => openAllDay(d))),
      year(...dates.map((d) => closedMidday(d))),
    );
    expect(changes).toHaveLength(1);
    expect(describeScrapeDiff(changes, today).split("\n")[0]).toBe(
      "Schedule changed on 3 day(s): 3 upcoming, 0 past",
    );
  });

  it("caps the listing so a mass change still fits in one message", () => {
    const dates = Array.from(
      { length: 40 },
      (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`,
    ).filter((d) => d <= "2026-10-31");
    // Every day changes, but alternating between two different new states so
    // consecutive days never collapse into one entry.
    const changes = diffScrapeResults(
      year(...dates.map((d) => openAllDay(d))),
      year(
        ...dates.map((d, i) =>
          i % 2 === 0 ? closedMidday(d) : openAllDay(d, "Field Rained Out"),
        ),
      ),
    );
    const message = describeScrapeDiff(changes, today);
    expect(changes.length).toBeGreaterThan(20);
    expect(message).toContain("more");
    expect(message.length).toBeLessThan(1800);
  });

  it("says so when the bytes changed but no day did", () => {
    expect(describeScrapeDiff([], today)).toContain(
      "no date's schedule differs",
    );
  });
});
