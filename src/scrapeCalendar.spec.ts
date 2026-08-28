import { it, describe, expect } from "vitest";
import { toMinute } from "./dates";
import { stream, streamAtEnd } from "./parsing";
import {
  ctxMinuteRangeParser,
  ctxTimeToMinuteParser,
  getIntervals,
  getScrapeDebugResult,
  parseAndReorderEntries,
  timeSpanReParser,
} from "./scrapeCalendar";

describe("ctxMinuteRangeParser", () => {
  const range = { startMinute: toMinute(14, 0), endMinute: toMinute(20, 45) };
  [
    // Real scraped copy uses thin spaces (&thinsp;) around the dash. Escapes,
    // not literals: invisible and look-alike characters cannot be reviewed by
    // eye and are easily mangled in transit.
    { input: "2:00 PM\u2009-\u20098:45 PM", result: range },
    { input: "2:00 PM to 8:45 PM", result: range },
    // Every dash variant that might show up upstream. An en dash used to
    // throw "Invalid name" and abort the entire scrape.
    { input: "2:00 PM - 8:45 PM", result: range },
    { input: "2:00 PM \u2013 8:45 PM", result: range }, // en dash
    { input: "2:00 PM \u2014 8:45 PM", result: range }, // em dash
    { input: "2:00 PM \u2212 8:45 PM", result: range }, // minus sign
    { input: "2:00 PM \u2010 8:45 PM", result: range }, // hyphen
    { input: "2:00 PM\u2009\u2013\u20098:45 PM", result: range },
  ].forEach(({ input, result }) => {
    it(`should parse ${JSON.stringify(input)}`, () => {
      const r = ctxMinuteRangeParser(stream(input));
      expect(r?.result).toEqual(result);
      if (r) {
        expect(streamAtEnd(r.s)).toBe(true);
      }
    });
  });
});
describe("ctxTimeToMinuteParser", () => {
  [
    {
      input: "2",
      result: { value: toMinute(2, 0), ampm: false },
    },
    {
      input: "2 a.m.",
      result: { value: toMinute(2, 0), ampm: true },
    },
    {
      input: "2 p.m.",
      result: { value: toMinute(14, 0), ampm: true },
    },
  ].forEach(({ input, result }) => {
    it(`should parse ${input}`, () => {
      const r = ctxTimeToMinuteParser(stream(input));
      expect(r?.result).toEqual(result);
      if (r) {
        expect(streamAtEnd(r.s)).toBe(true);
      }
    });
  });
});

describe("parseAndReorderEntries", () => {
  it("can parse a cycle track event date", () => {
    const dateRules = {
      date: "2025-09-07",
      entries: [
        {
          name: "Cycle Track Open for Public Use Until 8:30 a.m.",
          startDate: "2025-09-07T05:00:00",
          description: "",
          subHeaderDate: "September 7, 2025, 5:00 AM - 8:30 AM",
          headingName: "Cycle Track Open for Public Use Until 8:30 a.m.",
        },
        {
          name: "Cycle Track in Use for Private Event",
          startDate: "2025-09-07T08:30",
          description: "",
          subHeaderDate: "September 7, 2025, 8:30 AM - 11:30 AM",
          headingName: "Cycle Track in Use for Private Event",
        },
        {
          name: "Cycle Track Open for Public Use After 6:45 p.m.",
          startDate: "2025-09-07T18:45:00",
          description: "",
          subHeaderDate: "September 7, 2025, 6:45 PM",
          headingName: "Cycle Track Open for Public Use After 6:45 p.m.",
        },
      ],
    };
    expect(parseAndReorderEntries(dateRules)).toEqual([
      {
        endMinute: 510,
        open: true,
      },
      {
        comment: "Colden Kimber Memorial Ride 💐",
        endMinute: 690,
        open: false,
        startMinute: 510,
      },
      {
        open: true,
        startMinute: 1125,
      },
    ]);
  });
});

describe("getIntervals", () => {
  it("can parse a typical date with a closure", () => {
    const dateRules = {
      date: "2025-09-10",
      entries: [
        {
          name: "Cycle Track Open Until 2 p.m.",
          startDate: "2025-09-10T05:00:00",
          description: "",
          subHeaderDate: "September 10, 2025, 5:00 AM - 2:00 PM",
          headingName: "Cycle Track Open Until 2 p.m.",
        },
        {
          name: "Cycle Track Open After 6:45 p.m.",
          startDate: "2025-09-10T18:45:00",
          description: "",
          subHeaderDate: "September 10, 2025, 6:45 PM",
          headingName: "Cycle Track Open After 6:45 p.m.",
        },
      ],
    };
    expect(getIntervals(dateRules, false)).toEqual([
      {
        end_timestamp: "2025-09-10 13:59",
        open: true,
        start_timestamp: "2025-09-10 00:00",
      },
      {
        end_timestamp: "2025-09-10 18:44",
        open: false,
        start_timestamp: "2025-09-10 14:00",
      },
      {
        end_timestamp: "2025-09-10 23:59",
        open: true,
        start_timestamp: "2025-09-10 18:45",
      },
    ]);
  });
  it("parses turkey trot", () => {
    const dateRules = {
      date: "2025-11-27",
      entries: [
        {
          name: "Cycle Track Closed Until 7:00 AM (Turkey Trot event)",
          startDate: "2025-11-27T05:00:00",
          description: "",
          subHeaderDate: "November 27, 2025, 5:00 AM - 7:00 AM",
          headingName: "Cycle Track Closed Until 7:00 AM (Turkey Trot event)",
        },
        {
          name: "Cycle Track Open After 11:00 AM",
          startDate: "2025-11-27T11:00",
          description: "",
          subHeaderDate: "November 27, 2025, 11:00 AM",
          headingName: "Cycle Track Open After 11:00 AM",
        },
      ],
    };
    expect(getIntervals(dateRules, false)).toEqual([
      {
        end_timestamp: "2025-11-27 04:59",
        open: true,
        start_timestamp: "2025-11-27 00:00",
      },
      {
        comment: "Turkey Trot event",
        end_timestamp: "2025-11-27 06:59",
        open: false,
        start_timestamp: "2025-11-27 05:00",
      },
      {
        end_timestamp: "2025-11-27 10:59",
        open: false,
        start_timestamp: "2025-11-27 07:00",
      },
      {
        end_timestamp: "2025-11-27 23:59",
        open: true,
        start_timestamp: "2025-11-27 11:00",
      },
    ]);
  });
  it("can parse a cycle track event date", () => {
    const dateRules = {
      date: "2025-09-07",
      entries: [
        {
          name: "Cycle Track Open for Public Use Until 8:30 a.m.",
          startDate: "2025-09-07T05:00:00",
          description: "",
          subHeaderDate: "September 7, 2025, 5:00 AM - 8:30 AM",
          headingName: "Cycle Track Open for Public Use Until 8:30 a.m.",
        },
        {
          name: "Cycle Track in Use for Private Event",
          startDate: "2025-09-07T08:30",
          description: "",
          subHeaderDate: "September 7, 2025, 8:30 AM - 11:30 AM",
          headingName: "Cycle Track in Use for Private Event",
        },
        {
          name: "Cycle Track Open for Public Use After 6:45 p.m.",
          startDate: "2025-09-07T18:45:00",
          description: "",
          subHeaderDate: "September 7, 2025, 6:45 PM",
          headingName: "Cycle Track Open for Public Use After 6:45 p.m.",
        },
      ],
    };
    expect(getIntervals(dateRules, false)).toEqual([
      {
        end_timestamp: "2025-09-07 08:29",
        open: true,
        start_timestamp: "2025-09-07 00:00",
      },
      {
        end_timestamp: "2025-09-07 11:29",
        open: false,
        start_timestamp: "2025-09-07 08:30",
        comment: "Colden Kimber Memorial Ride 💐",
      },
      {
        end_timestamp: "2025-09-07 18:44",
        open: false,
        start_timestamp: "2025-09-07 11:30",
      },
      {
        end_timestamp: "2025-09-07 23:59",
        open: true,
        start_timestamp: "2025-09-07 18:45",
      },
    ]);
  });
  it("can parse an overlapping until/after date", () => {
    const dateRules = {
      date: "2025-09-12",
      entries: [
        {
          name: "Cycle Track Open Until 7:30 a.m.",
          startDate: "2025-09-12T05:00:00",
          description: "",
          subHeaderDate: "September 12, 2025, 5:00 AM - 7:30 AM",
          headingName: "Cycle Track Open Until 7:30 a.m.",
        },
        {
          name: "Cycle Track Open After 12:30 PM",
          startDate: "2025-09-12T24:30",
          description: "",
          subHeaderDate: "September 12, 2025, 12:30 PM - 2:00 PM",
          headingName: "Cycle Track Open After 12:30 PM",
        },
        {
          name: "Cycle Track Open Until 2:00 PM",
          startDate: "2025-09-12T24:30",
          description: "",
          subHeaderDate: "September 12, 2025, 12:30 PM - 2:00 PM",
          headingName: "Cycle Track Open Until 2:00 PM",
        },
        {
          name: "Cycle Track Open After 6:45 p.m.",
          startDate: "2025-09-12T18:45:00",
          description: "",
          subHeaderDate: "September 12, 2025, 6:45 PM",
          headingName: "Cycle Track Open After 6:45 p.m.",
        },
      ],
    };
    expect(getIntervals(dateRules, false)).toEqual([
      {
        open: true,
        start_timestamp: "2025-09-12 00:00",
        end_timestamp: "2025-09-12 07:29",
      },
      {
        open: false,
        start_timestamp: "2025-09-12 07:30",
        end_timestamp: "2025-09-12 12:29",
      },
      {
        open: true,
        start_timestamp: "2025-09-12 12:30",
        end_timestamp: "2025-09-12 13:59",
      },
      {
        open: false,
        start_timestamp: "2025-09-12 14:00",
        end_timestamp: "2025-09-12 18:44",
      },
      {
        open: true,
        start_timestamp: "2025-09-12 18:45",
        end_timestamp: "2025-09-12 23:59",
      },
    ]);
  });
});

describe("timeSpanReParser", () => {
  [
    {
      input: "all day",
      result: {
        startMinute: toMinute(0, 0),
        endMinute: toMinute(24, 0),
      },
    },
    {
      input: "until 2 p.m.",
      result: {
        endMinute: toMinute(14, 0),
      },
    },
    {
      input: "after 10 a.m.",
      result: {
        startMinute: toMinute(10, 0),
      },
    },
    {
      input: "2-10 p.m.",
      result: {
        startMinute: toMinute(14, 0),
        endMinute: toMinute(22, 0),
      },
    },
    {
      input: "5 a.m. to 2 p.m.",
      result: {
        startMinute: toMinute(5, 0),
        endMinute: toMinute(14, 0),
      },
    },
    {
      input: "2-6:45 p.m.",
      result: {
        startMinute: toMinute(14, 0),
        endMinute: toMinute(18, 45),
      },
    },
  ].forEach(({ input, result }) => {
    it(`should parse ${input}`, () => {
      const r = timeSpanReParser(stream(input));
      expect(r?.result).toEqual(result);
      if (r) {
        expect(streamAtEnd(r.s)).toBe(true);
      }
    });
  });
});

describe("names without Open/Closed", () => {
  // First seen 2026-08-19: SF Rec & Park posted "Cycle Track Until 11:00 AM"
  // (no "Open"); a bare time span implies open.
  const entry = {
    name: "Cycle Track Until 11:00 AM",
    startDate: "2026-08-19T05:00",
    description: "",
    subHeaderDate: "August 19, 2026, 5:00 AM - 11:00 AM",
    headingName: "Cycle Track Until 11:00 AM",
  };
  it("parses 'Cycle Track Until 11:00 AM' as open", () => {
    expect(
      parseAndReorderEntries({ date: "2026-08-19", entries: [entry] }),
    ).toEqual([
      {
        open: true,
        endMinute: toMinute(11, 0),
      },
    ]);
  });
  it("produces intervals for the whole day", () => {
    expect(
      getIntervals({ date: "2026-08-19", entries: [entry] }, false),
    ).toEqual([
      {
        open: true,
        start_timestamp: "2026-08-19 00:00",
        end_timestamp: "2026-08-19 10:59",
      },
      {
        open: false,
        start_timestamp: "2026-08-19 11:00",
        end_timestamp: "2026-08-19 23:59",
      },
    ]);
  });
});

describe("names upstream invented later", () => {
  // "Before" is a synonym for "Until" (first seen 2026-09-01, on 47 days).
  it("parses 'Open Before 2:00 PM' the same as 'Open Until 2:00 PM'", () => {
    const entries = (name: string) => [
      {
        name,
        startDate: "2026-09-01T05:00",
        description: "",
        subHeaderDate: "September 1, 2026, 5:00 AM - 2:00 PM",
        headingName: name,
      },
    ];
    const before = getIntervals(
      { date: "2026-09-01", entries: entries("Cycle Track Open Before 2:00 PM") },
      false,
    );
    const until = getIntervals(
      { date: "2026-09-01", entries: entries("Cycle Track Open Until 2:00 PM") },
      false,
    );
    expect(before).toEqual(until);
    expect(before).toEqual([
      {
        open: true,
        start_timestamp: "2026-09-01 00:00",
        end_timestamp: "2026-09-01 13:59",
      },
      {
        open: false,
        start_timestamp: "2026-09-01 14:00",
        end_timestamp: "2026-09-01 23:59",
      },
    ]);
  });

  // A reason with no parentheses (first seen 2026-10-02). The subHeaderDate
  // carries no time range either, so this only parses if the name alone is
  // fully understood.
  it("parses 'Closed All Day Due to Special Event'", () => {
    expect(
      getIntervals(
        {
          date: "2026-10-02",
          entries: [
            {
              name: "Cycle Track Closed All Day Due to Special Event",
              startDate: "2026-10-02T05:00",
              description: "",
              subHeaderDate: "October 2, 2026, 5:00 AM",
              headingName: "Cycle Track Closed All Day Due to Special Event",
            },
          ],
        },
        false,
      ),
    ).toEqual([
      {
        open: false,
        comment: "Special Event",
        start_timestamp: "2026-10-02 00:00",
        end_timestamp: "2026-10-02 23:59",
      },
    ]);
  });

  // Parenthesised reasons must keep working.
  it("still parses a parenthesised reason", () => {
    expect(
      getIntervals(
        {
          date: "2026-05-16",
          entries: [
            {
              name: "Cycle Track Closed (Event Preparation, Event & Load Out)",
              startDate: "2026-05-16T05:00",
              description: "",
              subHeaderDate: "May 16, 2026, 5:00 AM - 8:00 PM",
              headingName: "Cycle Track Closed (Event Preparation, Event & Load Out)",
            },
          ],
        },
        false,
      ),
    ).toEqual([
      {
        open: true,
        start_timestamp: "2026-05-16 00:00",
        end_timestamp: "2026-05-16 04:59",
      },
      {
        open: false,
        comment: "Event Preparation, Event & Load Out",
        start_timestamp: "2026-05-16 05:00",
        end_timestamp: "2026-05-16 19:59",
      },
      {
        open: true,
        start_timestamp: "2026-05-16 20:00",
        end_timestamp: "2026-05-16 23:59",
      },
    ]);
  });
});

describe("unparseable entries degrade to unknown_rules", () => {
  it("does not throw for a name no parser understands", () => {
    const result = getScrapeDebugResult({
      years: [
        {
          type: "year",
          year: 2026,
          rules: [
            {
              date: "2026-08-20",
              entries: [
                {
                  name: "Velodrome Vibes Only",
                  startDate: "2026-08-20T05:00",
                  description: "",
                  subHeaderDate: "August 20, 2026, 5:00 AM",
                  headingName: "Velodrome Vibes Only",
                },
              ],
            },
          ],
        },
      ],
      fieldRainoutInfo: {},
    });
    expect(result[0].rules[0].recognizer).toBe(null);
    expect(result[0].rules[0].rules).toMatchObject({
      type: "unknown_rules",
      start_date: "2026-08-20",
      end_date: "2026-08-20",
    });
  });

  it("hands the failure to onUnrecognized so it can be reported", () => {
    const seen: { date: string; message: string; names: string[] }[] = [];
    getScrapeDebugResult(
      {
        years: [
          {
            type: "year",
            year: 2026,
            rules: [
              {
                date: "2026-08-20",
                entries: [
                  {
                    name: "Velodrome Vibes Only",
                    startDate: "2026-08-20T05:00",
                    description: "",
                    subHeaderDate: "August 20, 2026, 5:00 AM",
                    headingName: "Velodrome Vibes Only",
                  },
                ],
              },
            ],
          },
        ],
        fieldRainoutInfo: {},
      },
      ({ date, error, entries }) => {
        seen.push({
          date,
          message: error instanceof Error ? error.message : String(error),
          names: entries.map((e) => e.name),
        });
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].date).toBe("2026-08-20");
    expect(seen[0].names).toEqual(["Velodrome Vibes Only"]);
    // The message carries the offending entry, which is what makes the
    // Sentry issue actionable.
    expect(seen[0].message).toContain("Velodrome Vibes Only");
  });
});
