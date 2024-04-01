import { it, describe, expect } from "vitest";
import { toMinute } from "./dates";
import { stream, streamAtEnd } from "./parsing";
import {
  ctxMinuteRangeParser,
  ctxTimeToMinuteParser,
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
