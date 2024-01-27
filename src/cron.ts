import {
  toMinute,
  startOfDay,
  endOfDay,
  parseDate,
  addDays,
  addMinutes,
  daily,
  monthDayStyle,
  shortDateStyle,
  shortTimeStyle,
  getTodayPacific,
  parseTimestamp,
  timestampToMinutes,
} from "./dates";
import { discordReport, runDiscordWebhook } from "./discord";
import {
  stream,
  streamAtEnd,
  mapParser,
  Parser,
  Stream,
  setCursor,
  parseFirst,
  parseAll,
  apSecond,
  apFirst,
  optional,
  ensureEndParsed,
  parseSepBy1,
  succeed,
  ap,
  parseMany1,
} from "./parsing";
import { runSlackWebhook } from "./slack";
import { Bindings } from "./types";

export const POLO_URL = "https://www.sfrecpark.org/526/Polo-Field-Usage";

interface Year<T> {
  readonly type: "year";
  readonly year: number;
  readonly rules: T[];
}

type Levels = Readonly<
  Record<"span" | "underline" | "strong" | "ul" | "li" | "p", number>
>;
export interface Rule {
  readonly type: "rule";
  readonly buffer: readonly BufferEntry[];
}
interface BufferEntry {
  readonly text: string;
  readonly levels: Levels;
}
export interface UnknownRules {
  readonly type: "unknown_rules";
  readonly text: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly rules: string[];
}

export interface KnownRules extends Omit<UnknownRules, "type"> {
  readonly type: "known_rules";
  readonly intervals: RuleInterval[];
}

export interface RuleInterval {
  readonly open: boolean;
  readonly start_timestamp: string;
  readonly end_timestamp: string;
  readonly comment?: string;
}

const MONTHS =
  /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)|Nov(?:ember)?|Dec(?:ember)?)/gi;
const DAY_NUMBER_RE = /([1-3][0-9]|[1-9])/gi;
const DAY_RANGE_RE = /\b(\d{1,2})\b(?:\s*-\s*(\d{1,2}))?/gi;
const DATE_RULES_RE = new RegExp(
  `${MONTHS.source}\\s+${DAY_RANGE_RE.source}`,
  "ig",
);
const DATE_RANGE_RE = new RegExp(
  `${MONTHS.source}\\s+${DAY_NUMBER_RE.source}(?:\\s*(?:-|thru|through)\\s*(?:${MONTHS.source}\\s+)?${DAY_NUMBER_RE.source})?`,
  "ig",
);
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap](?:\.m\.|m))/gi;
const WHITESPACE_RE = /\s+/g;
const MONTHS_TABLE = MONTHS.source
  .replace(/^[^(]*\((.*)\)[^)]*$/g, "$1")
  .replace(/[^a-zA-Z|]/g, "")
  .split("|")
  .map((s) => s.substring(0, 3));
const WEEKDAY_RE =
  /\b(Sun(?:day)?|Mon(?:day)?|Tue(sday)?|Wed(nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?)s?\b/gi;
// const DAYS_TABLE = DAYS.source
//   .replace(/^[^(]*\((.*)\)[^)]*$/g, "$1")
//   .replace(/[^a-zA-Z|]/g, "")
//   .split("|")
//   .map((s) => s.substring(0, 3));
export const WEEKDAYS: Record<
  "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat",
  number
> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
export const WEEKDAYS_TABLE = Object.keys(
  WEEKDAYS,
) as readonly (keyof typeof WEEKDAYS)[];

function dateInterval(date: Date, open: boolean, comment?: string) {
  return {
    start_timestamp: shortTimeStyle.format(date),
    end_timestamp: shortTimeStyle.format(addMinutes(date, toMinute(24, -1))),
    open,
    comment,
  };
}

function dayInterval(
  start_date: string,
  end_date: string,
  open: boolean,
  comment?: string,
) {
  return {
    start_timestamp: startOfDay(start_date),
    end_timestamp: endOfDay(end_date),
    open,
    comment,
  };
}

function minuteIntervals(
  date: Date,
  start_minute: number,
  end_minute: number,
  open: boolean,
  comment?: string,
): RuleInterval[] {
  const r = [];
  if (start_minute > 0) {
    r.push({
      open: !open,
      start_timestamp: shortTimeStyle.format(date),
      end_timestamp: shortTimeStyle.format(addMinutes(date, start_minute - 1)),
    });
  }
  r.push({
    open,
    start_timestamp: shortTimeStyle.format(addMinutes(date, start_minute)),
    end_timestamp: shortTimeStyle.format(addMinutes(date, end_minute - 1)),
    comment,
  });
  if (end_minute < toMinute(24, 0)) {
    r.push({
      open: !open,
      start_timestamp: shortTimeStyle.format(addMinutes(date, end_minute)),
      end_timestamp: shortTimeStyle.format(addMinutes(date, toMinute(24, -1))),
    });
  }
  return r;
}

function closedMinuteIntervals(
  date: Date,
  start_minute: number,
  end_minute: number,
  comment?: string,
): RuleInterval[] {
  return minuteIntervals(date, start_minute, end_minute, false, comment);
}

function closedIntervals(
  date: Date,
  start_hour: number,
  end_hour: number,
  comment?: string,
): RuleInterval[] {
  return closedMinuteIntervals(
    date,
    toMinute(start_hour, 0),
    toMinute(end_hour, 0),
    comment,
  );
}

function toKnown(rule: UnknownRules, intervals: RuleInterval[]): KnownRules {
  return {
    ...rule,
    type: "known_rules",
    intervals: compressIntervals(intervals),
  };
}

function adjacentTimestamps(a: string, b: string) {
  const at = parseTimestamp(a);
  const bt = parseTimestamp(b);
  return addMinutes(at, 1).getTime() === bt.getTime();
}

function compressIntervals(arr: RuleInterval[]) {
  const result: RuleInterval[] = [];
  for (const v of arr) {
    const prev: undefined | RuleInterval = result[result.length - 1];
    if (
      prev &&
      prev.open === v.open &&
      prev.comment === v.comment &&
      adjacentTimestamps(prev.end_timestamp, v.start_timestamp)
    ) {
      result[result.length - 1] = { ...prev, end_timestamp: v.end_timestamp };
    } else {
      result.push(v);
    }
  }
  return result;
}

export type Recognizer = {
  (rule: UnknownRules): KnownRules | undefined;
  name: string;
};

function recognizer(
  name: string,
  regexp: RegExp,
  match: (rule: UnknownRules, m: RegExpMatchArray) => RuleInterval[],
): Recognizer {
  const fn = (rule: UnknownRules): KnownRules | undefined => {
    const allRules = rule.rules.join(" ");
    const m = allRules.match(regexp);
    return m ? toKnown(rule, match(rule, m)) : undefined;
  };
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

interface DateInterval {
  readonly start_date: string;
  readonly end_date: string;
}

// January -> "01"
const parseMonth = mapParser(reParser(MONTHS), (m) => parseMonthToISO(m[1]));
// 1 -> "01"
const parseDayNumber = mapParser(reParser(DAY_NUMBER_RE), (m) =>
  m[1].padStart(2, "0"),
);

const parseSeparator = reParser(/\s*(?:,\s*(?:and)?|and)\s*/gi);
const parseOptionalColon = reParser(/\s*[,:]?\s*/gi);

type DateRuleStep = (date: Date) => RuleInterval[] | undefined;
type ExceptionRuleStep = (
  date: Date,
  intervals: RuleInterval[] | undefined,
) => RuleInterval[] | undefined;

function reParser(regexp: RegExp): Parser<RegExpExecArray> {
  if (regexp.flags.indexOf("g") === -1) {
    throw new Error("Expected regexp to be global: " + regexp);
  }
  return (s: Stream) => {
    regexp.lastIndex = s.cursor;
    const result = regexp.exec(s.input);
    return result && result.index === s.cursor
      ? { s: setCursor(s, regexp.lastIndex), result }
      : undefined;
  };
}

export interface DateRange {
  readonly start_month: string;
  readonly end_month: string;
  readonly start_day: string;
  readonly end_day: string;
}
const dateRangeParser = mapParser(reParser(DATE_RANGE_RE), (m) => {
  const start_month = parseMonthToISO(m[1]);
  const end_month = m[3] ? parseMonthToISO(m[3]) : start_month;
  return {
    start_month,
    end_month,
    start_day: m[2].padStart(2, "0"),
    end_day: (m[4] || m[2]).padStart(2, "0"),
  } satisfies DateRange;
});

const weekdayReParser = mapParser(
  reParser(WEEKDAY_RE),
  (result) => result[1].substring(0, 3) as keyof typeof WEEKDAYS,
);

const wsParser = reParser(WHITESPACE_RE);

export const timeToMinuteParser = parseFirst(
  mapParser(reParser(TIME_RE), (result) =>
    toMinute(
      (parseInt(result[1], 10) % 12) + (/p/i.test(result[3]) ? 12 : 0),
      parseInt(result[2] ?? "0", 10),
    ),
  ),
  mapParser(reParser(/noon/gi), () => toMinute(12, 0)),
);

export const timeSpanReParser = parseFirst(
  // "8:00 AM to 8:45 PM"
  mapParser(
    parseAll(
      apSecond(reParser(/\s*(?:from\s+)?/gi), timeToMinuteParser),
      apSecond(
        reParser(/\s+to\s+/gi),
        apFirst(timeToMinuteParser, optional(wsParser)),
      ),
    ),
    ([start_minute, end_minute]) =>
      ({ start_minute, end_minute, open: false }) as const,
  ),
  // "before 2 p.m. and after 6:45 p.m."
  mapParser(
    parseAll(
      apSecond(reParser(/\s*before\s+/gi), timeToMinuteParser),
      apSecond(
        reParser(/\s+and after\s+/gi),
        apFirst(timeToMinuteParser, optional(wsParser)),
      ),
    ),
    ([start_minute, end_minute]) =>
      ({ start_minute, end_minute, open: false }) as const,
  ),
  // "all day"
  mapParser(reParser(/\s*all day\s*/gi), () => {
    return {
      start_minute: 0,
      end_minute: toMinute(24, 0),
      open: true,
    } as const;
  }),
);

// Friday, September 15 -> "09-15"
export const longDateParser = mapParser(
  parseAll(
    // "Friday, "
    apFirst(weekdayReParser, parseSeparator),
    // "September "
    apFirst(parseMonth, optional(wsParser)),
    // "15 "
    parseDayNumber,
  ),
  ([_weekday, month, day]) => `${month}-${day}`,
);

// "Friday, September 15 when track is closed from 7:30 a.m. to 12:30 p.m. for Sacred Heart Walkathon"
export const parseFallException = mapParser(
  ensureEndParsed(
    parseAll(
      parseSepBy1(longDateParser, parseSeparator),
      apSecond(
        // "when track is closed "
        reParser(/\s*when track is closed\s*/gi),
        // "from 7:30 a.m. to 12:30 p.m."
        timeSpanReParser,
      ),
      // " for Sacred Heart Walkathon"
      mapParser(reParser(/\s*for\s+(.*)/gi), (m) => m[1]),
    ),
  ),
  ([monthDays, { start_minute, end_minute }, comment]) =>
    (date: Date): RuleInterval[] | undefined =>
      monthDays.includes(monthDayStyle.format(date))
        ? closedMinuteIntervals(date, start_minute, end_minute, comment)
        : undefined,
);

// Sundays, from March 3 thru May 12, when track will be open before 10 a.m. and after 6:45 p.m.
// Sunday, May 19 when track will be open all day with the field closed due to the Bay to Breakers event
export const parseSpringException = mapParser(
  ensureEndParsed(
    parseAll(
      // Sundays
      mapParser(weekdayReParser, (w) => WEEKDAYS[w]),
      apSecond(
        // , from
        reParser(/\s*(,\s*)?(from\s+)?/gi),
        // March 3 thru May 12
        dateRangeParser,
      ),
      // , when track will be open
      apSecond(
        reParser(/\s*(,\s*)?when track will be open\s*/gi),
        // before 10 a.m. and after 6:45 p.m.
        timeSpanReParser,
      ),
      optional(
        mapParser(
          reParser(
            /\s*with the field closed due to the Bay to Breakers event\.?\s*/gi,
          ),
          () => "Bay to Breakers",
        ),
      ),
    ),
  ),
  ([weekday, range, times, comment]) =>
    (date: Date): RuleInterval[] | undefined =>
      date.getDay() === weekday && isDateInRange(date, range)
        ? minuteIntervals(
            date,
            times.start_minute,
            times.end_minute,
            times.open,
            comment ?? "Youth and Adult Sports Programs",
          )
        : undefined,
);

// (*On Tuesdays beginning March 12, the cycling track will be open after 8:45 p.m. On Thursdays beginning March 14, the track will be open after 8:45 p.m.)

export const onWeekdayExceptionData = parseAll(
  apSecond(
    reParser(/\s*\*?On\s+/gi),
    mapParser(weekdayReParser, (d) => WEEKDAYS[d]),
  ),
  mapParser(
    apSecond(reParser(/\s*beginning\s*/gi), dateRangeParser),
    ({ start_month, start_day }) => ({ start_month, start_day }),
  ),
  apSecond(
    reParser(/\s*,\s+the (cycling )?track will be open after\s*/gi),
    timeToMinuteParser,
  ),
);

const compileWeekdayException =
  ([weekday, range, start_minute]: [
    number,
    Pick<DateRange, "start_month" | "start_day">,
    number,
  ]): ExceptionRuleStep =>
  (date, intervals) => {
    if (
      intervals &&
      date.getDay() === weekday &&
      afterDateRangeStart(date, range)
    ) {
      if (intervals.length !== 3) {
        throw new Error("Expecting 3 intervals");
      }
      if (!intervals[1].comment) {
        throw new Error("Missing comment");
      }
      return closedMinuteIntervals(
        date,
        timestampToMinutes(intervals[1].start_timestamp),
        start_minute,
        intervals[1].comment,
      );
    }
  };

export const weekdayExceptionsData = apSecond(
  reParser(/\s*\(\s*/gi),
  apFirst(
    parseSepBy1(onWeekdayExceptionData, reParser(/\s*\.?\s*/gi)),
    reParser(/\s*\)\s*/gi),
  ),
);

export function reducePredicates(predicates: readonly DateRuleStep[]) {
  return (date: Date) => {
    for (const p of predicates) {
      const r = p(date);
      if (r) {
        return r;
      }
    }
    return [dateInterval(date, true)];
  };
}

function reduceExceptionRuleSteps(
  exceptions: readonly ExceptionRuleStep[],
): ExceptionRuleStep {
  return (date, intervals) => {
    for (const f of exceptions) {
      const r = f(date, intervals);
      if (r) {
        return r;
      }
    }
    return intervals;
  };
}

export const weekdayList = apFirst(
  parseSepBy1(
    mapParser(
      // Monday
      // Monday*
      apFirst(weekdayReParser, optional(reParser(/\*/gi))),
      (d) => WEEKDAYS[d],
    ),
    parseSeparator,
  ),
  parseOptionalColon,
);

export const parseWeekdayTimesData = ensureEndParsed(
  parseAll(
    apFirst(
      parseSepBy1(
        mapParser(
          // Monday
          // Monday*
          apFirst(weekdayReParser, optional(reParser(/\*/gi))),
          (d) => WEEKDAYS[d],
        ),
        parseSeparator,
      ),
      parseOptionalColon,
    ),
    // "8:00 AM to 8:45 PM"
    // "before 2 p.m. and after 6:45 p.m."
    timeSpanReParser,
    // Exceptions
    optional(weekdayExceptionsData),
  ),
);

export function parseWeekdayTimes(
  interval: DateInterval,
  comment?: string,
): Parser<DateRuleStep> {
  return mapParser(
    parseWeekdayTimesData,
    ([days, { start_minute, end_minute, open }, exceptionsData]) => {
      const interval_start = parseDate(interval.start_date);
      const interval_end = addDays(parseDate(interval.end_date), 1);
      const exceptions = reduceExceptionRuleSteps(
        (exceptionsData ?? []).map(compileWeekdayException),
      );
      return (date: Date): RuleInterval[] | undefined => {
        if (
          date.getTime() < interval_start.getTime() ||
          date.getTime() >= interval_end.getTime() ||
          !days.includes(date.getDay())
        ) {
          return undefined;
        }
        const intervals = minuteIntervals(
          date,
          start_minute,
          end_minute,
          open,
          open ? undefined : comment,
        );
        return exceptions(date, intervals);
      };
    },
  );
}

const weekendPreludeRe = reParser(
  /- Saturdays and Sundays all day EXCEPT on /gi,
);
const closedPreParser = reParser(/\s*\(closed\s*/gi);
const closedPostParser = reParser(/\s*\)\s*(?:and\s)?/gi);

const dateRangeTimeSpanParser = ap(
  apFirst(dateRangeParser, closedPreParser),
  mapParser(
    apFirst(timeSpanReParser, closedPostParser),
    (timeSpan) => (dateRange) => ({ ...timeSpan, ...dateRange }) as const,
  ),
);

function parseWeekendExcept(comment?: string): Parser<DateRuleStep> {
  // - Saturdays and Sundays before 7 a.m. and after 6:15 p.m. EXCEPT:
  // Saturdays and Sundays before 7 a.m. and after 6:15 p.m. EXCEPT:
  return mapParser(
    apSecond(
      reParser(/(- )?Saturdays and Sundays\s+/gi),
      apFirst(timeSpanReParser, exceptionPrelude),
    ),
    ({ start_minute, end_minute }) =>
      (date: Date): RuleInterval[] | undefined => {
        if (date.getDay() !== WEEKDAYS.Sat && date.getDay() !== WEEKDAYS.Sun) {
          return undefined;
        }
        return closedMinuteIntervals(date, start_minute, end_minute, comment);
      },
  );
}

function afterDateRangeStart(
  date: Date,
  range: Pick<DateRange, "start_day" | "start_month">,
) {
  const fmt = shortDateStyle.format(date);
  return fmt >= `${date.getFullYear()}-${range.start_month}-${range.start_day}`;
}

function isDateInRange(date: Date, range: DateRange) {
  const fmt = shortDateStyle.format(date);
  return (
    fmt >= `${date.getFullYear()}-${range.start_month}-${range.start_day}` &&
    fmt <= `${date.getFullYear()}-${range.end_month}-${range.end_day}`
  );
}

function parseWeekendTimes(
  interval: DateInterval,
  comment?: string,
): Parser<DateRuleStep> {
  // "- Saturdays and Sundays all day EXCEPT on July 8 (closed 7:30 AM to 5:30 PM) and July 9 (closed 7:30 AM to 4:30 PM)"
  return mapParser(
    apSecond(
      weekendPreludeRe,
      ensureEndParsed(parseMany1(dateRangeTimeSpanParser)),
    ),
    (exceptions) =>
      (date: Date): RuleInterval[] | undefined => {
        if (date.getDay() !== WEEKDAYS.Sat || date.getDay() !== WEEKDAYS.Sun) {
          return undefined;
        }
        for (const {
          start_minute,
          end_minute,
          start_month,
          end_month,
          start_day,
          end_day,
        } of exceptions) {
          const dateStr = shortDateStyle.format(date);
          if (
            dateStr >= `${date.getFullYear()}-${start_month}-${start_day}` &&
            dateStr <= `${date.getFullYear()}-${end_month}-${end_day}`
          ) {
            return closedMinuteIntervals(
              date,
              start_minute,
              end_minute,
              comment,
            );
          }
        }
        return [dateInterval(date, true)];
      },
  );
}

const fallPreludeRe = mapParser(
  reParser(/Fall (.+?)\s*begin\. The Cycle Track Will be Open:/gi),
  (m) => m[1].trim(),
);

const partialClosuresParser = mapParser(
  parseAll(
    parseAll(longDateParser, apSecond(reParser(/\s*and\s*/gi), longDateParser)),
    reParser(/\s*-\s* (Partial closures.*)\./gi),
  ),
  ([dates, comment]): DateRuleStep =>
    (date: Date): RuleInterval[] | undefined => {
      const fmt = shortDateStyle.format(date);
      for (const d of dates) {
        if (fmt.endsWith(d)) {
          return [dayInterval(fmt, fmt, true, comment[1])];
        }
      }
    },
);

// Saturday, February 24 from 7:45 a.m. to 4:45 p.m. and Sunday, February from 7:45 a.m. to 3:45 p.m. when track will be closed for a sports tournament.
const weekendTournamentParser = mapParser(
  parseAll(
    parseSepBy1(
      parseAll(
        // Saturday, February 24
        // OR
        // Sunday, February
        parseFirst(
          longDateParser,
          mapParser(reParser(/Sunday, February( 25)?/gi), () => "02-25"),
        ),
        // from 7:45 a.m. to 4:45 p.m.
        timeSpanReParser,
      ),
      reParser(/\s*and\s*/gi),
    ),
    mapParser(
      reParser(/\s*when track will be closed for a sports tournament\./gi),
      () => "Sports Tournament",
    ),
  ),
  ([dateTimes, comment]): DateRuleStep =>
    (date: Date): RuleInterval[] | undefined => {
      const fmt = shortDateStyle.format(date);
      for (const [d, t] of dateTimes) {
        if (fmt.endsWith(d)) {
          return closedMinuteIntervals(
            date,
            t.start_minute,
            t.end_minute,
            comment,
          );
        }
      }
    },
);

const exceptionPrelude = ensureEndParsed(reParser(/\s*EXCEPT:\s*/gi));

function janFebRecognizer(rule: UnknownRules): KnownRules | undefined {
  const { rules } = rule;
  // The Cycle Track will remain open - Polo Field Closed
  // EXCEPT:
  // Monday, January 22 and Tuesday, January 23 - Partial closures of the track in the morning for asphalt repairs.
  // Saturday, February 24 from 7:45 a.m. to 4:45 p.m. and Sunday, February from 7:45 a.m. to 3:45 p.m. when track will be closed for a sports tournament.
  if (rules.length === 0) {
    return undefined;
  }
  let comment: string | undefined;
  let state: "prelude" | "rules" | "exception" = "prelude";
  const excParser = parseFirst(partialClosuresParser, weekendTournamentParser);
  const predicates: DateRuleStep[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    let s = stream(r);
    switch (state) {
      case "prelude": {
        const m = ensureEndParsed(
          reParser(
            /The Cycle Track will remain open - Polo Fields? Closed\s*/gi,
          ),
        )(s);
        if (!m) {
          return undefined;
        }
        state = "rules";
        continue;
      }
      case "rules": {
        const m = exceptionPrelude(s);
        if (!m) {
          return undefined;
        }
        state = "exception";
        continue;
      }
      case "exception": {
        const m = excParser(s);
        if (!m) {
          return undefined;
        }
        predicates.push(m.result);
        continue;
      }
    }
  }
  return toKnown(
    rule,
    daily(rule.start_date, rule.end_date, reducePredicates(predicates)),
  );
}

const marchMayPreludeRe = mapParser(
  reParser(/^(.*?)Begin. The Cycle Track Will be Open:\s*/gi),
  (m) => m[1].trim(),
);

function marchMayRecognizer(rule: UnknownRules): KnownRules | undefined {
  // Youth and Adult Sports Programs Begin. The Cycle Track Will be Open:
  // Mondays all day
  // Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m. (*On Tuesdays beginning March 12, the cycling track will be open after 8:45 p.m. On Thursdays beginning March 14, the track will be open after 8:45 p.m.)
  // Saturdays before 7 a.m. and after 6:45 p.m.
  // Sundays before 7 a.m. and after 6:45 p.m.
  // EXCEPT:
  // Sundays, from March 3 thru May 12, when track will be open before 10 a.m. and after 6:45 p.m.
  // Sunday, May 19 when track will be open all day with the field closed due to the Bay to Breakers event
  const { rules } = rule;
  if (rules.length === 0) {
    return undefined;
  }
  let comment: string | undefined;
  let state: "prelude" | "rules" | "exception" = "prelude";
  const predicates: DateRuleStep[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    let s = stream(r);
    switch (state) {
      case "prelude": {
        const m = marchMayPreludeRe(s);
        if (!m) {
          return undefined;
        }
        comment = m.result;
        state = "rules";
        continue;
      }
      case "rules": {
        const m = parseWeekdayTimes(rule, comment)(s);
        if (m) {
          predicates.push(m.result);
          continue;
        } else if (exceptionPrelude(s)) {
          state = "exception";
          continue;
        }
      }
      case "exception": {
        const m = parseSpringException(s);
        if (m) {
          predicates.unshift(m.result);
          continue;
        }
      }
    }
    console.log(`Failed to parse marchMay times in state ${state}:`, r);
    return undefined;
  }
  return toKnown(
    rule,
    daily(rule.start_date, rule.end_date, reducePredicates(predicates)),
  );
}

function fallRecognizer(rule: UnknownRules): KnownRules | undefined {
  const { rules } = rule;
  // Fall Youth and Adult Sports Programs Begin. The Cycle Track Will be Open:
  // Mondays all day
  // Tuesdays, Wednesdays, Thursdays and Fridays before 2 p.m. and after 6:45 p.m.
  // EXCEPT:
  // Friday, September 13 when track is closed from 7:30 a.m. to 12:30 p.m. for Sacred Heart Walkathon
  // Friday, October 4 when track is closed all day for Hardly Strictly Bluegrass
  // Wednesday, November 20 when track is closed from noon to 6 p.m. for SFUSD Cross Country Finals
  // Saturdays and Sundays before 7 a.m. and after 6:15 p.m. EXCEPT:
  // Saturday, October 5 and Sunday, October 6 when track is closed all day for Hardly Strictly Bluegrass
  if (rules.length === 0) {
    return undefined;
  }
  let comment: string | undefined;
  let state: "prelude" | "rules" | "exception" = "prelude";
  const predicates: DateRuleStep[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    let s = stream(r);
    switch (state) {
      case "prelude": {
        const m = fallPreludeRe(s);
        if (!m) {
          return undefined;
        }
        comment = m.result;
        state = "rules";
        continue;
      }
      case "rules": {
        const m = parseFirst(
          parseWeekdayTimes(rule, comment),
          parseWeekendTimes(rule, comment),
        )(s);
        if (m) {
          predicates.push(m.result);
          continue;
        } else if (exceptionPrelude(s)) {
          state = "exception";
          continue;
        }
      }
      case "exception": {
        const m = parseFallException(s);
        if (m) {
          predicates.unshift(m.result);
          continue;
        }
        const m2 = parseWeekendExcept(comment)(s);
        if (m2) {
          predicates.push(m2.result);
          continue;
        }
      }
    }
    console.log(`Failed to parse fall times in state ${state}:`, r);
    return undefined;
  }
  return toKnown(
    rule,
    daily(rule.start_date, rule.end_date, reducePredicates(predicates)),
  );
}

export const RECOGNIZERS = [
  recognizer(
    "openAllDayEveryDay",
    /^(The Cycle Track will remain open - Polo Fields? Closed|The Cycle Track Will be Open Mondays through Sundays all day)$/i,
    (rule) => [dayInterval(rule.start_date, rule.end_date, true)],
  ),
  recognizer(
    "closedForOutsideLands",
    /^The Cycle Track will be closed for Outside Lands Load in, Event and Load Out( and Polo Fields Concert Event and Load Out)?$/i,
    (rule) => [
      dayInterval(rule.start_date, rule.end_date, false, "Outside Lands"),
    ],
  ),
  recognizer(
    "closedForOneEvent",
    /^The Cycle Track (?:will be )?Closed for (?<comment>(?:\w+ )+)from (?<start>\d+) ((?<startampm>[ap])\.m\. )?to (?<end>\d+) (?<ampm>[ap])\.m\.$/i,
    (rule, m) => {
      const ampmStart = /p/i.test(m.groups?.startampm ?? m.groups?.ampm ?? "")
        ? 12
        : 0;
      const ampmEnd = /p/i.test(m.groups?.ampm ?? "") ? 12 : 0;
      const start_hour = (parseInt(m.groups?.start ?? "", 10) % 12) + ampmStart;
      const end_hour = parseInt(m.groups?.end ?? "", 10) + ampmEnd;
      const comment = m.groups?.comment.trim();

      return daily(rule.start_date, rule.end_date, (date) =>
        closedIntervals(date, start_hour, end_hour, comment),
      );
    },
  ),
  recognizer(
    "openAfter",
    /^The Cycle Track will be open after (?<start>\d+) (?<startampm>[ap])\.m\.$/i,
    (rule, m) => {
      const ampmStart = /p/i.test(m.groups?.startampm ?? m.groups?.ampm ?? "")
        ? 12
        : 0;
      const start_hour = (parseInt(m.groups?.start ?? "", 10) % 12) + ampmStart;
      return daily(rule.start_date, rule.end_date, (date) =>
        closedIntervals(date, 0, start_hour),
      );
    },
  ),
  marchMayRecognizer,
  janFebRecognizer,
  fallRecognizer,
];

export function nlpDebugRule(rule: UnknownRules): RecognizerRules {
  for (const r of RECOGNIZERS) {
    const known = r(rule);
    if (known) {
      return { recognizer: r, rules: known };
    }
  }
  return { recognizer: null, rules: rule };
}

function levelsEq(a: Levels, b: Levels): boolean {
  return (
    a.span === b.span &&
    a.underline === b.underline &&
    a.strong === b.strong &&
    a.ul === b.ul &&
    a.li === b.li &&
    a.p === b.p
  );
}

function joinBuffer(buffer: readonly BufferEntry[]): readonly BufferEntry[] {
  const result: BufferEntry[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const entry = buffer[i];
    const prev = result[result.length - 1];
    if (prev && levelsEq(prev.levels, entry.levels)) {
      result[result.length - 1] = { ...prev, text: prev.text + entry.text };
    } else {
      result.push(entry);
    }
  }
  return result.filter((entry) => !/^\s*(&nbsp;\s*)*$/.test(entry.text));
}

function parseMonthToISO(month: string): string {
  const monthIndex = MONTHS_TABLE.indexOf(month.substring(0, 3));
  if (monthIndex < 0) {
    throw new Error(`Failed to parse month: ${month}`);
  }
  return `${monthIndex + 1}`.padStart(2, "0");
}

function parseDateRules(year: number) {
  const fmt = (year: number, month: string, day: string): string =>
    `${year}-${month}-${day.padStart(2, "0")}`;
  return (
    text: string,
  ): { start_date: string; end_date: string } | undefined => {
    DATE_RULES_RE.lastIndex = 0;
    let m = DATE_RULES_RE.exec(text);
    if (!m) {
      return;
    }
    const start_month = parseMonthToISO(m[1]);
    const start_date = fmt(year, start_month, m[2]);
    let end_date = start_date;
    if (m[3]) {
      end_date = fmt(year, start_month, m[3]);
    } else if ((m = DATE_RULES_RE.exec(text))) {
      const end_month = parseMonthToISO(m[1]);
      end_date = fmt(year, end_month, m[2]);
    }
    return { start_date, end_date };
  };
}

function reduceYearRules(year: number) {
  const parser = parseDateRules(year);
  return (acc: UnknownRules[], rule: Rule): UnknownRules[] => {
    const last: UnknownRules | undefined = acc[acc.length - 1];
    for (const entry of rule.buffer) {
      const { levels, text } = entry;
      let parsed;
      if (
        levels.strong === 1 &&
        levels.p === 1 &&
        levels.span > 0 &&
        (parsed = parser(text))
      ) {
        acc.push({
          type: "unknown_rules",
          text,
          ...parsed,
          rules: [],
        });
      } else if (last) {
        last.rules.push(
          ...rule.buffer.map((e) =>
            e.text
              .replace(/&nbsp;/g, " ")
              .replace(/&bull;/g, "-")
              .replace(/[ ]+/g, " ")
              .trim(),
          ),
        );
      }
    }
    return acc;
  };
}

export type RecognizerRules =
  | { readonly recognizer: null; readonly rules: UnknownRules }
  | { readonly recognizer: Recognizer; readonly rules: KnownRules };

export type ScrapeResult = Year<UnknownRules | KnownRules>[];
export type ScrapeDebugResult = Year<RecognizerRules>[];
export class ScheduleScraper implements HTMLRewriterElementContentHandlers {
  state: "initial" | "start" | "copy" | "done" = "initial";
  levels: Levels = {
    span: 0,
    underline: 0,
    strong: 0,
    ul: 0,
    li: 0,
    p: 0,
  };
  years: Year<Rule>[] = [];
  inSpan: boolean = false;
  buffer: BufferEntry[] = [];
  getDebugResult(): ScrapeDebugResult {
    return this.years.map((y) => ({
      ...y,
      rules: y.rules.reduce(reduceYearRules(y.year), []).map(nlpDebugRule),
    }));
  }
  getResult(): ScrapeResult {
    return this.getDebugResult().map((y) => ({
      ...y,
      rules: y.rules.map((r) => r.rules),
    }));
  }
  element(element: Element) {
    switch (this.state) {
      case "initial": {
        if (
          element.tagName === "html" ||
          element.tagName === "body" ||
          element.tagName === "div"
        ) {
          element.remove();
        } else {
          if (
            element.tagName === "h1" &&
            element.getAttribute("id") === "versionHeadLine"
          ) {
            this.state = "start";
          }
          element.remove();
        }
        break;
      }
      case "start": {
        if (
          element.tagName === "div" &&
          element.getAttribute("class")?.match(/\bpageContent\b/)
        ) {
          this.state = "copy";
          element.remove();
          element.onEndTag((endTag) => {
            this.state = "done";
            this.flushBuffer(endTag);
          });
        }
        break;
      }
      case "copy": {
        const levels = this.levels;
        switch (element.tagName) {
          case "strong": {
            this.levels = { ...levels, strong: levels.strong + 1 };
            element.onEndTag(() => {
              this.levels = levels;
            });
            break;
          }
          case "li": {
            this.levels = { ...levels, li: levels.li + 1 };
            element.onEndTag((endTag) => {
              this.levels = levels;
              this.flushBuffer(endTag);
            });
            break;
          }
          case "p": {
            this.levels = { ...levels, p: levels.p + 1 };
            element.onEndTag((endTag) => {
              this.levels = levels;
              this.flushBuffer(endTag);
            });
            break;
          }
          case "span": {
            this.levels = {
              ...levels,
              span: levels.span + 1,
              underline: element
                .getAttribute("style")
                ?.match(/\btext-decoration: underline;\b/)
                ? levels.underline + 1
                : levels.underline,
            };
            element.onEndTag(() => {
              this.levels = levels;
            });
            break;
          }
          default: {
            break;
          }
        }
        element.remove();
        break;
      }
      case "done": {
        element.remove();
        break;
      }
    }
  }
  text(element: Text) {
    if (
      element.text.length > 0 &&
      this.state === "copy" &&
      this.levels.span > 0
    ) {
      const m = element.text.match(/^\d{4}$/);
      if (m) {
        this.buffer.splice(0, this.buffer.length);
        this.years.push({
          type: "year",
          year: parseInt(m[0], 10),
          rules: [],
        });
      } else if (this.years.length > 0) {
        this.buffer.push({
          levels: this.levels,
          text: element.text,
        });
      }
    }
    element.remove();
  }
  flushBuffer(endTag: EndTag) {
    if (this.buffer.length === 0) {
      return;
    }
    this.years[this.years.length - 1]?.rules.push({
      type: "rule",
      buffer: joinBuffer(this.buffer.splice(0, this.buffer.length)),
    });
  }
}

export function intervalsForDate(
  result: ScrapeResult,
  date: string,
):
  | {
      readonly type: "known";
      readonly intervals: RuleInterval[];
      readonly rule: KnownRules;
    }
  | { readonly type: "unknown"; readonly rule: UnknownRules }
  | undefined {
  let maxYear: number | null = null;
  const year = parseInt(date.split("-")[0], 10);
  for (const sched of result) {
    maxYear = Math.max(maxYear ?? sched.year, sched.year);
    if (sched.year !== year) {
      continue;
    }
    for (const rule of sched.rules) {
      if (rule.start_date <= date && rule.end_date >= date) {
        if (rule.type === "unknown_rules") {
          return { type: "unknown", rule };
        }
        const intervals = rule.intervals.filter(
          (interval) =>
            interval.start_timestamp.split(" ")[0] <= date &&
            interval.end_timestamp.split(" ")[0] >= date,
        );
        return { type: "known", intervals, rule };
      }
    }
  }
  if (maxYear !== null) {
    const nextYear = maxYear + 1;
    const jan1 = `${nextYear}-01-01`;
    const jan31 = `${nextYear}-01-31`;
    if (date >= jan1 && date <= jan31) {
      const intervals = [
        {
          start_timestamp: `${jan1} 00:00`,
          end_timestamp: `${jan31} 23:59`,
          open: true,
        },
      ];
      return {
        type: "known",
        intervals,
        rule: {
          type: "known_rules",
          intervals,
          text: `January ${nextYear}`,
          rules: [
            "[polofield.bike assumption] PF is historically open all January",
          ],
          start_date: jan1,
          end_date: jan31,
        },
      };
    }
  }
  return undefined;
}

export async function scrapePoloURL(): Promise<ScrapeResult> {
  const scraper = new ScheduleScraper();
  const res = new HTMLRewriter()
    .on("*", scraper)
    .transform(await fetch(POLO_URL));
  await res.text();
  return scraper.getResult();
}

interface ScrapeResultsRow {
  readonly created_at: string;
  readonly scrape_results_json: string;
}

export interface CachedScrapeResult {
  readonly created_at: string;
  readonly scrape_results: ScrapeResult;
}

export async function recentScrapedResults(
  env: Bindings,
  limit = 1000,
): Promise<CachedScrapeResult[]> {
  return (
    await env.DB.prepare(
      `SELECT created_at, scrape_results_json FROM scrape_results ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all<ScrapeResultsRow>()
  ).results.map(({ created_at, scrape_results_json }) => ({
    created_at,
    scrape_results: JSON.parse(scrape_results_json),
  }));
}

export async function cachedScrapeResult(
  env: Bindings,
): Promise<CachedScrapeResult> {
  const results = await recentScrapedResults(env, 1);
  if (results.length === 0) {
    console.error(`Expected cached row in scraped_results`);
    return await refreshScrapeResult(env);
  }
  return results[0];
}

export async function refreshScrapeResult(
  env: Bindings,
  { log }: { readonly log?: boolean } = {},
): Promise<CachedScrapeResult> {
  const result = await scrapePoloURL();
  const prev = await env.DB.prepare(
    `SELECT created_at, scrape_results_json FROM scrape_results ORDER BY created_at DESC LIMIT 1`,
  ).all<ScrapeResultsRow>();
  const created_at = new Date().toISOString();
  const scrape_results_json = JSON.stringify(result);
  if (
    prev.results.length > 0 &&
    prev.results[0].scrape_results_json === scrape_results_json
  ) {
    if (log) {
      console.log(
        `No change since ${prev.results[0].created_at}, skipping ${created_at}`,
      );
    }
    return {
      created_at: prev.results[0].created_at,
      scrape_results: JSON.parse(prev.results[0].scrape_results_json),
    };
  } else if (result.length === 0 && prev.results.length > 0) {
    if (log) {
      console.log(`Error detected when scraping, skipping ${created_at}`);
      await discordReport(
        env,
        `Error detected when scraping, skipping ${created_at}`,
      );
    }
    return {
      created_at: prev.results[0].created_at,
      scrape_results: JSON.parse(prev.results[0].scrape_results_json),
    };
  } else {
    await env.DB.prepare(
      `INSERT INTO scrape_results (created_at, scrape_results_json) VALUES (?, ?)`,
    )
      .bind(created_at, scrape_results_json)
      .run();
    if (log) {
      console.log(`Inserted new scrape result at ${created_at}`);
      await discordReport(env, `Inserted new scrape result at ${created_at}`);
    }
    return { created_at, scrape_results: result };
  }
}

async function bootstrapWebhooks(env: Bindings): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    console.log("no discord webhook url");
    return;
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_webhook_status (webhook_url, params_json, last_update_utc) VALUES (?, ?, '1970-01-01')`,
  )
    .bind(env.DISCORD_WEBHOOK_URL, JSON.stringify({ type: "discord" }))
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_webhook_status (webhook_url, params_json, last_update_utc) VALUES (?, ?, '1970-01-01')`,
  )
    .bind("slack://", JSON.stringify({ type: "slack:chat.postMessage" }))
    .run();
}

async function runWebhooks(
  env: Bindings,
  { scrape_results }: CachedScrapeResult,
): Promise<void> {
  // Shift to reporting the next day at 4pm instead of midnight
  const now = new Date();
  now.setHours(now.getHours() - 16);
  const today = getTodayPacific(now);
  const rows = await env.DB.prepare(
    `SELECT webhook_url, params_json, last_update_utc FROM daily_webhook_status WHERE last_update_utc < ?`,
  )
    .bind(today)
    .all<Record<"webhook_url" | "last_update_utc" | "params_json", string>>();
  const tomorrow = addDays(parseDate(today), 1);
  await Promise.allSettled(
    rows.results.map(async (row) => {
      const params = JSON.parse(row.params_json);
      if (params.type === "discord") {
        await runDiscordWebhook(env, {
          webhook_url: row.webhook_url,
          date: tomorrow,
          params: params,
          scrape_results,
        });
      } else if (params.type === "slack:chat.postMessage") {
        await runSlackWebhook(env, {
          webhook_url: row.webhook_url,
          date: tomorrow,
          params: params,
          scrape_results,
        });
      } else {
        throw new Error(`Unknown webhook type: ${params.type}`);
      }
      await env.DB.prepare(
        `UPDATE daily_webhook_status SET last_update_utc = ? WHERE webhook_url = ?`,
      )
        .bind(today, row.webhook_url)
        .run();
    }),
  );
}

export async function cronBody(env: Bindings): Promise<CachedScrapeResult> {
  const result = await refreshScrapeResult(env, { log: true });
  await bootstrapWebhooks(env);
  await runWebhooks(env, result);
  return result;
}

export async function handleCron(
  event: ScheduledController,
  env: Bindings,
): Promise<void> {
  await cronBody(env);
}
