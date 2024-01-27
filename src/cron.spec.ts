import { describe, expect, it } from "vitest";
import {
  parseFallException,
  timeSpanReParser,
  timeToMinuteParser,
  intervalsForDate,
  type ScrapeResult,
  parseWeekdayTimes,
  weekdayList,
  onWeekdayExceptionData,
  WEEKDAYS,
  WEEKDAYS_TABLE,
  parseWeekdayTimesData,
} from "./cron";
import {
  toMinute,
  shortDateStyle,
  timeToMinutes,
  parseDate,
  addDays,
} from "./dates";
import { ResultOfParser, stream, streamAtEnd } from "./parsing";

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
        rules: [
          "[polofield.bike assumption] PF is historically open all January",
        ],
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
      result: {
        start_minute: toMinute(8, 0),
        end_minute: toMinute(20, 45),
        open: false,
      },
    },
    {
      input: "before 2 p.m. and after 6:45 p.m.",
      result: {
        start_minute: toMinute(14, 0),
        end_minute: toMinute(18, 45),
        open: false,
      },
    },
    {
      input: "all day",
      result: {
        start_minute: toMinute(0, 0),
        end_minute: toMinute(24, 0),
        open: true,
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
describe("weekdayList", () => {
  const input = "Tuesdays*, Wednesdays, Thursdays* and Fridays";
  it(`should parse ${input}`, () => {
    const r = weekdayList(stream(input));
    expect(r).toEqual({
      result: [2, 3, 4, 5],
      s: { cursor: input.length, input },
    });
  });
});
describe("onWeekdayExceptionData", () => {
  const parses: {
    input: string;
    output: ResultOfParser<typeof onWeekdayExceptionData>;
  }[] = [
    {
      input:
        "*On Tuesdays beginning March 12, the cycling track will be open after 8:45 p.m.",
      output: [
        2,
        { start_month: "03", start_day: "12" },
        timeToMinutes("20:45"),
      ],
    },
    {
      input:
        "On Thursdays beginning March 14, the track will be open after 8:45 p.m.",
      output: [
        4,
        { start_month: "03", start_day: "14" },
        timeToMinutes("20:45"),
      ],
    },
  ];
  parses.forEach(({ input, output }) => {
    it(`should parse ${input}`, () => {
      const r = onWeekdayExceptionData(stream(input));
      expect(r).toBeDefined();
      expect(r?.result).toEqual(output);
    });
  });
});
describe("parseWeekdayTimesData", () => {
  // no exceptions
  const input0 = `Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m.`;
  it(`parses ${input0}`, () =>
    expect(parseWeekdayTimesData(stream(input0))).toEqual({
      result: [
        [WEEKDAYS.Tue, WEEKDAYS.Wed, WEEKDAYS.Thu, WEEKDAYS.Fri],
        {
          start_minute: toMinute(14, 0),
          end_minute: toMinute(18, 45),
          open: false,
        },
        undefined,
      ],
      s: { cursor: input0.length, input: input0 },
    }));
  const input = `Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m. (*On Tuesdays beginning March 12, the cycling track will be open after 8:45 p.m. On Thursdays beginning March 14, the track will be open after 8:45 p.m.)`;
  it(`parses ${input}`, () =>
    expect(parseWeekdayTimesData(stream(input))).toEqual({
      result: [
        [WEEKDAYS.Tue, WEEKDAYS.Wed, WEEKDAYS.Thu, WEEKDAYS.Fri],
        {
          start_minute: toMinute(14, 0),
          end_minute: toMinute(18, 45),
          open: false,
        },
        [
          [
            WEEKDAYS.Tue,
            { start_month: "03", start_day: "12" },
            toMinute(20, 45),
          ],
          [
            WEEKDAYS.Thu,
            { start_month: "03", start_day: "14" },
            toMinute(20, 45),
          ],
        ],
      ],
      s: { cursor: input.length, input: input },
    }));
});

describe("parseWeekdayTimes", () => {
  const rule = {
    start_date: "2024-02-26",
    end_date: "2024-05-26",
    comment: "Youth and Adult Sports Programs",
  };
  // no exceptions
  const input0 = `Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m.`;
  describe(`should parse without exceptions`, () => {
    const r = parseWeekdayTimes(
      { start_date: "2024-02-26", end_date: "2024-05-26" },
      "Youth and Adult Sports Programs",
    )(stream(input0));
    it(`parses ${input0}`, () => expect(r).toBeDefined());
    let date = parseDate(rule.start_date);
    const endDate = parseDate(rule.end_date);
    for (; date.getTime() <= endDate.getTime(); date = addDays(date, 1)) {
      const day = date.getDay();
      if (day >= 2 && day <= 5) {
        it(
          `is open before 2pm and after 6:45pm on ${
            WEEKDAYS_TABLE[day]
          } ${shortDateStyle.format(date)}`,
          (
            (date) => () =>
              expect(r?.result(date)).toEqual([
                {
                  start_timestamp: `${shortDateStyle.format(date)} 00:00`,
                  end_timestamp: `${shortDateStyle.format(date)} 13:59`,
                  open: true,
                },
                {
                  start_timestamp: `${shortDateStyle.format(date)} 14:00`,
                  end_timestamp: `${shortDateStyle.format(date)} 18:44`,
                  open: false,
                  comment: rule.comment,
                },
                {
                  start_timestamp: `${shortDateStyle.format(date)} 18:45`,
                  end_timestamp: `${shortDateStyle.format(date)} 23:59`,
                  open: true,
                },
              ])
          )(date),
        );
      } else {
        it(
          `does not apply on ${shortDateStyle.format(date)}`,
          (
            (date) => () =>
              expect(r?.result(date)).toBe(undefined)
          )(date),
        );
      }
    }
  });
  const input = `Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m. (*On Tuesdays beginning March 12, the cycling track will be open after 8:45 p.m. On Thursdays beginning March 14, the track will be open after 8:45 p.m.)`;
  describe(`should parse with exceptions`, () => {
    const r = parseWeekdayTimes(rule, rule.comment)(stream(input));
    let date = parseDate(rule.start_date);
    const endDate = parseDate(rule.end_date);
    const excDate = parseDate("2024-03-12");
    for (; date.getTime() <= endDate.getTime(); date = addDays(date, 1)) {
      const day = date.getDay();
      if (day >= 2 && day <= 5) {
        if ((day === 2 || day === 4) && date.getTime() >= excDate.getTime()) {
          it(
            `is open before 2pm and after 8:45pm on ${
              WEEKDAYS_TABLE[day]
            } ${shortDateStyle.format(date)}`,
            (
              (date) => () =>
                expect(r?.result(date)).toEqual([
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 00:00`,
                    end_timestamp: `${shortDateStyle.format(date)} 13:59`,
                    open: true,
                  },
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 14:00`,
                    end_timestamp: `${shortDateStyle.format(date)} 20:44`,
                    open: false,
                    comment: rule.comment,
                  },
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 20:45`,
                    end_timestamp: `${shortDateStyle.format(date)} 23:59`,
                    open: true,
                  },
                ])
            )(date),
          );
        } else {
          it(
            `is open before 2pm and after 6:45pm on ${
              WEEKDAYS_TABLE[day]
            } ${shortDateStyle.format(date)}`,
            (
              (date) => () =>
                expect(r?.result(date)).toEqual([
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 00:00`,
                    end_timestamp: `${shortDateStyle.format(date)} 13:59`,
                    open: true,
                  },
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 14:00`,
                    end_timestamp: `${shortDateStyle.format(date)} 18:44`,
                    open: false,
                    comment: rule.comment,
                  },
                  {
                    start_timestamp: `${shortDateStyle.format(date)} 18:45`,
                    end_timestamp: `${shortDateStyle.format(date)} 23:59`,
                    open: true,
                  },
                ])
            )(date),
          );
        }
      } else {
        it(
          `does not apply on ${shortDateStyle.format(date)}`,
          (
            (date) => () =>
              expect(r?.result(date)).toBe(undefined)
          )(date),
        );
      }
    }
    const f = (s: string) => r!.result(parseDate(s));
    // Out of bounds checks
    expect(f("2024-02-25")).toEqual(undefined);
    expect(f("2024-05-27")).toEqual(undefined);
  });
});
