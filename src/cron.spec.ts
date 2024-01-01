import {
  parseFallException,
  timeSpanReParser,
  timeToMinuteParser,
  intervalsForDate,
  type ScrapeResult,
} from "./cron";
import { toMinute, shortDateStyle } from "./dates";
import { stream, streamAtEnd } from "./parsing";

describe("intervalsForDate", () => {
  it("Will make an assumption for January of maxYear+1", () => {
    const result: ScrapeResult = [
      {
        type: "year",
        year: 2023,
        rules: [
          {
            type: "known_rules",
            text: "Sunday, January 1 through Sunday, February 26",
            start_date: "2023-01-01",
            end_date: "2023-02-26",
            rules: ["The Cycle Track will remain open - Polo Field Closed"],
            intervals: [
              {
                start_timestamp: "2023-01-01 00:00",
                end_timestamp: "2023-02-26 23:59",
                open: true,
              },
            ],
          },
        ],
      },
    ];
    const nextYear = 2024;
    const jan1 = `${nextYear}-01-01 00:00`;
    const jan31 = `${nextYear}-01-31 23:59`;
    const intervals = [
      { start_timestamp: jan1, end_timestamp: jan31, open: true },
    ];
    const janRules = {
      type: "known",
      intervals,
      rule: {
        type: "known_rules",
        intervals,
        text: `January ${nextYear}`,
        rules: ["[polofield.bike assumption] PF is historically open all January"],
        start_date: jan1.split(" ")[0],
        end_date: jan31.split(" ")[0],
      },
    };
    expect(intervalsForDate(result, "2024-01-01")).toEqual(janRules);
    expect(intervalsForDate(result, "2024-01-02")).toEqual(janRules);
  });
});

describe("timeToMinuteParser", () => {
  [
    { input: "8:00 AM", result: toMinute(8, 0) },
    { input: "2 p.m.", result: toMinute(14, 0) },
    { input: "2pm", result: toMinute(14, 0) },
    { input: "2 pm", result: toMinute(14, 0) },
    { input: "6:45 p.m.", result: toMinute(18, 45) },
    { input: "6:45 pm", result: toMinute(18, 45) },
    { input: "6:45pm", result: toMinute(18, 45) },
  ].forEach(({ input, result }) => {
    it(`should parse ${input}`, () => {
      const r = timeToMinuteParser(stream(input));
      expect(r?.result).toEqual(result);
      if (r) {
        expect(streamAtEnd(r.s)).toBe(true);
      }
    });
  });
});
describe("timeSpanReParser", () => {
  [
    {
      input: "8:00 AM to 8:45 PM",
      result: { start_minute: toMinute(8, 0), end_minute: toMinute(20, 45) },
    },
    {
      input: "before 2 p.m. and after 6:45 p.m.",
      result: { start_minute: toMinute(14, 0), end_minute: toMinute(18, 45) },
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
describe("parseFallException", () => {
  const input1 =
    "Friday, September 15 when track is closed from 7:30 a.m. to 12:30 p.m. for Sacred Heart Walkathon";
  it(`should parse ${input1}`, () => {
    const r = parseFallException(stream(input1));
    expect(r).toBeDefined();
    if (r) {
      expect(streamAtEnd(r.s)).toBe(true);
      expect(r.result(new Date(2023, 8, 15))).toEqual([
        {
          start_timestamp: "2023-09-15 00:00",
          end_timestamp: "2023-09-15 07:29",
          open: true,
        },
        {
          start_timestamp: "2023-09-15 07:30",
          end_timestamp: "2023-09-15 12:29",
          open: false,
          comment: "Sacred Heart Walkathon",
        },
        {
          start_timestamp: "2023-09-15 12:30",
          end_timestamp: "2023-09-15 23:59",
          open: true,
        },
      ]);
      expect(r.result(new Date(2023, 8, 14))).toBe(undefined);
      expect(r.result(new Date(2023, 8, 16))).toBe(undefined);
    }
  });
  const input2 =
    "Friday, September 29 when track is closed all day for Hardly Strictly Bluegrass";
  it(`should parse ${input2}`, () => {
    const r = parseFallException(stream(input2));
    expect(r).toBeDefined();
    if (r) {
      expect(streamAtEnd(r.s)).toBe(true);
      expect(r.result(new Date(2023, 8, 29))).toEqual([
        {
          start_timestamp: "2023-09-29 00:00",
          end_timestamp: "2023-09-29 23:59",
          open: false,
          comment: "Hardly Strictly Bluegrass",
        },
      ]);
      expect(r.result(new Date(2023, 8, 14))).toBe(undefined);
      expect(r.result(new Date(2023, 8, 16))).toBe(undefined);
    }
  });
  const input3 =
    "Wednesday, November 15 when track is closed from noon to 6 p.m. for SFUSD Cross Country";
  it(`should parse ${input3}`, () => {
    const r = parseFallException(stream(input3));
    expect(r).toBeDefined();
    if (r) {
      expect(streamAtEnd(r.s)).toBe(true);
      expect(r.result(new Date(2023, 10, 15))).toEqual([
        {
          start_timestamp: "2023-11-15 00:00",
          end_timestamp: "2023-11-15 11:59",
          open: true,
        },
        {
          start_timestamp: "2023-11-15 12:00",
          end_timestamp: "2023-11-15 17:59",
          open: false,
          comment: "SFUSD Cross Country",
        },
        {
          start_timestamp: "2023-11-15 18:00",
          end_timestamp: "2023-11-15 23:59",
          open: true,
        },
      ]);
      expect(r.result(new Date(2023, 8, 14))).toBe(undefined);
      expect(r.result(new Date(2023, 8, 16))).toBe(undefined);
    }
  });
  const input4 =
    "Saturday, September 30 and Sunday, October 1 when track is closed all day for Hardly Strictly Bluegrass";
  it(`should parse ${input4}`, () => {
    const r = parseFallException(stream(input4));
    expect(r).toBeDefined();
    if (r) {
      expect(streamAtEnd(r.s)).toBe(true);
      [new Date(2023, 8, 30), new Date(2023, 9, 1)].forEach((d) => {
        expect(r.result(d)).toEqual([
          {
            start_timestamp: `${shortDateStyle.format(d)} 00:00`,
            end_timestamp: `${shortDateStyle.format(d)} 23:59`,
            open: false,
            comment: "Hardly Strictly Bluegrass",
          },
        ]);
      });
      expect(r.result(new Date(2023, 8, 14))).toBe(undefined);
      expect(r.result(new Date(2023, 8, 16))).toBe(undefined);
    }
  });
});
