import { it, describe, expect } from "vitest";
import { toMinute } from "./dates";
import { stream, streamAtEnd } from "./parsing";
import {
  ctxMinuteRangeParser,
  ctxTimeToMinuteParser,
  getIntervals,
  parseAndReorderEntries,
  timeSpanReParser,
} from "./scrapeCalendar";

describe("ctxMinuteRangeParser", () => {
  [
    {
      input: "2:00 PM - 8:45 PM",
      result: { startMinute: toMinute(14, 0), endMinute: toMinute(20, 45) },
    },
  ].forEach(({ input, result }) => {
    it(`should parse ${input}`, () => {
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
        comment: "Cycle Track in Use for Private Event",
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
        comment: "Cycle Track in Use for Private Event",
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
