import {
  toMinute,
  startOfDay,
  endOfDay,
  parseDate,
  isSameDay,
  addDays,
  addMinutes,
  daily,
  monthDayStyle,
  shortDateStyle,
  shortTimeStyle,
} from "./dates";
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
  `${MONTHS.source}\\s+${DAY_NUMBER_RE.source}(?:\\s*-\\s*(?:${MONTHS.source}\\s+)?${DAY_NUMBER_RE.source})?`,
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
const WEEKDAYS: Record<
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

function closedTimestampIntervals(
  date: Date,
  start_timestamp: Date,
  end_timestamp: Date,
  comment?: string,
): RuleInterval[] {
  if (
    end_timestamp < date ||
    start_timestamp >= addMinutes(date, toMinute(24, 0))
  ) {
    return [dateInterval(date, true)];
  }
  const start_minute = isSameDay(date, start_timestamp)
    ? toMinute(start_timestamp.getHours(), start_timestamp.getMinutes())
    : 0;
  const end_minute =
    (isSameDay(date, end_timestamp)
      ? toMinute(end_timestamp.getHours(), end_timestamp.getMinutes())
      : toMinute(24, 0)) - 1;
  return closedMinuteIntervals(date, start_minute, end_minute, comment);
}

function toKnown(rule: UnknownRules, intervals: RuleInterval[]): KnownRules {
  return {
    ...rule,
    type: "known_rules",
    intervals,
  };
}

type Recognizer = (rule: UnknownRules) => KnownRules | undefined;

function recognizer(
  regexp: RegExp,
  match: (rule: UnknownRules, m: RegExpMatchArray) => RuleInterval[],
): Recognizer {
  return (rule) => {
    const allRules = rule.rules.join(" ");
    const m = allRules.match(regexp);
    return m ? toKnown(rule, match(rule, m)) : undefined;
  };
}

interface DateInterval {
  readonly start_date: string;
  readonly end_date: string;
}

function parseDateInterval(year: number) {
  const fmt = (year: number, month: string, day: string): string =>
    `${year}-${month}-${day.padStart(2, "0")}`;
  return (s: string): DateInterval | undefined => {
    const r = dateRangeParser(stream(s));
    if (!r || !streamAtEnd(r.s)) {
      return undefined;
    }
    const { start_month, start_day, end_month, end_day } = r.result;
    return {
      start_date: fmt(year, start_month, start_day),
      end_date: fmt(year, end_month, end_day),
    };
  };
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

const EXCEPTION_RE = new RegExp(
  `\\(except on ${MONTHS.source}\\s+${DAY_NUMBER_RE.source}(?:\\s*-\\s*(?:${MONTHS.source}\\s+)?${DAY_NUMBER_RE.source})? when it will be open after ${TIME_RE.source}\\)`,
  "gi",
);
const parseExceptions: Parser<ExceptionRuleStep> = mapParser(
  reParser(EXCEPTION_RE),
  (m) => {
    const start_month = parseMonthToISO(m[1]);
    const start_day = m[2];
    const end_month = m[3] ? parseMonthToISO(m[3]) : start_month;
    const end_day = m[4] || start_day;
    if (!start_day || !end_day) {
      throw new Error("Could not parse day");
    }
    const open_hour = parseInt(m[5], 10) + (/p/i.test(m[7]) ? 12 : 0);
    const open_minute = parseInt(m[6], 10);
    return (date: Date, intervals: RuleInterval[] | undefined) => {
      if (!intervals) {
        return intervals;
      }
      const fmt = (month: string, day: string): string =>
        `${date.getFullYear()}-${month}-${day.padStart(2, "0")}`;
      const dateStr = shortDateStyle.format(date);
      const start_timestamp = shortTimeStyle.format(
        addMinutes(date, toMinute(open_hour, open_minute)),
      );
      if (
        dateStr >= fmt(start_month, start_day) &&
        dateStr <= fmt(end_month, end_day)
      ) {
        return intervals.map((v, i) =>
          v.open && i > 0 ? { ...v, start_timestamp } : v,
        );
      }
      return intervals;
    };
  },
);

function reParser(regexp: RegExp): Parser<RegExpExecArray> {
  return (s: Stream) => {
    regexp.lastIndex = s.cursor;
    const result = regexp.exec(s.input);
    return result && result.index === s.cursor
      ? { s: setCursor(s, regexp.lastIndex), result }
      : undefined;
  };
}

const dateRangeParser = mapParser(reParser(DATE_RANGE_RE), (m) => {
  const start_month = parseMonthToISO(m[1]);
  const end_month = m[3] ? parseMonthToISO(m[3]) : start_month;
  return {
    start_month,
    end_month,
    start_day: m[2],
    end_day: m[4] || m[2],
  } as const;
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
    ([start_minute, end_minute]) => ({ start_minute, end_minute }) as const,
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
    ([start_minute, end_minute]) => ({ start_minute, end_minute }) as const,
  ),
  // "all day"
  mapParser(reParser(/\s*all day\s*/gi), () => {
    return { start_minute: 0, end_minute: toMinute(24, 0) } as const;
  }),
);

// "Friday, September 15 when track is closed from 7:30 a.m. to 12:30 p.m. for Sacred Heart Walkathon"
export const parseFallException = mapParser(
  ensureEndParsed(
    parseAll(
      parseSepBy1(
        mapParser(
          parseAll(
            // "Friday, "
            apFirst(weekdayReParser, parseSeparator),
            // "September "
            apFirst(parseMonth, optional(wsParser)),
            // "15 "
            parseDayNumber,
          ),
          ([_weekday, month, day]) => `${month}-${day}`,
        ),
        parseSeparator,
      ),
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

function parseWeekdayTimes(
  interval: DateInterval,
  comment?: string,
): Parser<DateRuleStep> {
  return mapParser(
    ensureEndParsed(
      parseAll(
        apFirst(
          parseSepBy1(
            mapParser(weekdayReParser, (d) => WEEKDAYS[d]),
            parseSeparator,
          ),
          parseOptionalColon,
        ),
        // "8:00 AM to 8:45 PM"
        // "before 2 p.m. and after 6:45 p.m."
        timeSpanReParser,
        // Exceptions
        parseFirst(
          parseExceptions,
          succeed<ExceptionRuleStep>((_, intervals) => intervals),
        ),
      ),
    ),

    ([days, { start_minute, end_minute }, exceptions]) => {
      const interval_start = parseDate(interval.start_date);
      const interval_end = addDays(parseDate(interval.end_date), 1);
      // All day means open by default
      const open = start_minute === 0 && end_minute === toMinute(24, 0);
      return (date: Date): RuleInterval[] | undefined => {
        if (
          date < interval_start ||
          date >= interval_end ||
          !days.includes(date.getDay())
        ) {
          return;
        }
        return exceptions(
          date,
          minuteIntervals(
            date,
            start_minute,
            end_minute,
            open,
            open ? undefined : comment,
          ),
        );
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
  return mapParser(
    apSecond(
      reParser(/- Saturdays and Sundays\s+/gi),
      apFirst(timeSpanReParser, ensureEndParsed(reParser(/\s*EXCEPT:/gi))),
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
            dateStr >=
              `${date.getFullYear()}-${start_month}-${start_day.padStart(
                2,
                "0",
              )}` &&
            dateStr <=
              `${date.getFullYear()}-${end_month}-${end_day.padStart(2, "0")}`
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

function summerRecognizer(rule: UnknownRules): KnownRules | undefined {
  const { rules } = rule;
  // "Summer Camps, Youth and Adult Sports Programs will take place on the field. The Cycle Track Will be Open EXCEPT:",
  // "- During Weekday Summer Camps and Adults Sports Programming:",
  // "June 20-23",
  // "Tuesday and Thursday, 8:00 AM to 8:45 PM",
  // "Wednesday and Friday, 8:00 AM to 3:30 PM",
  // "June 27",
  // "Tuesday, 6:00 PM to 8:45 PM",
  // "July 3-7",
  // "Monday and Wednesday: 7:00 AM to 2:30 PM",
  // "Tuesday and Thursday, 7:00 AM to 8:45 PM (except on July 4 when it will be open after 2:30 PM)",
  // "Friday: 7:00 AM to 3:30 PM",
  // "July 10-14",
  // "Monday, Wednesday, Friday: 8:00 AM to 3:30 PM",
  // "Tuesday and Thursday, 8:00 AM to 8:45 PM",
  // "July 17-21",
  // "Monday, Wednesday, Friday: 8:00 AM to 4:30 PM",
  // "Tuesday and Thursday, 8:00 AM to 8:45 PM",
  // "- Saturdays and Sundays all day EXCEPT on July 8 (closed 7:30 AM to 5:30 PM) and July 9 (closed 7:30 AM to 4:30 PM)"
  if (rules.length === 0) {
    return undefined;
  }
  const dateIntervalParser = parseDateInterval(
    parseDate(rule.start_date).getFullYear(),
  );
  let currentInterval: DateInterval | null = null;
  let comment: string | undefined;
  const predicates: DateRuleStep[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (i === 0) {
      const m =
        /^(.+?)will take place on the field\. The Cycle Track Will be Open EXCEPT:$/i.exec(
          r,
        );
      if (!m) {
        return undefined;
      }
      comment = m[1].trim();
      continue;
    } else if (i === 1) {
      const m =
        /^- During Weekday Summer Camps and Adults Sports Programming:$/i.exec(
          r,
        );
      if (m) {
        continue;
      }
    }
    const range = dateIntervalParser(r);
    if (range) {
      currentInterval = range;
      continue;
    } else if (!currentInterval) {
      console.log("Expected interval to be set", r);
      return undefined;
    }
    const s = stream(r);
    const m = parseFirst(
      parseWeekdayTimes(currentInterval, comment),
      parseWeekendTimes(currentInterval, comment),
    )(s);
    if (m) {
      predicates.push(m.result);
      continue;
    }
    if (!m) {
      return undefined;
    }
  }
  return toKnown(
    rule,
    daily(rule.start_date, rule.end_date, (date) => {
      for (const p of predicates) {
        const r = p(date);
        if (r) {
          return r;
        }
      }
      return [dateInterval(date, true)];
    }),
  );
}

const fallPreludeRe = mapParser(
  reParser(/Fall (.+?)\s*begin\. The Cycle Track Will be Open:/gi),
  (m) => m[1].trim(),
);

function fallRecognizer(rule: UnknownRules): KnownRules | undefined {
  const { rules } = rule;
  // "Fall Youth and Adult Sports Programs Begin. The Cycle Track Will be Open:",
  // "Mondays all day",
  // "Tuesdays, Wednesdays, Thursdays and Fridays before 2 p.m. and after 6:45 p.m.",
  // "EXCEPT:",
  // "Friday, September 15 when track is closed from 7:30 a.m. to 12:30 p.m. for Sacred Heart Walkathon",
  // "Friday, September 29 when track is closed all day for Hardly Strictly Bluegrass",
  // "Wednesday, November 15 when track is closed from noon to 6 p.m. for SFUSD Cross Country",
  // "- Saturdays and Sundays before 7 a.m. and after 6:15 p.m. EXCEPT:",
  // "Saturday, September 30 and Sunday, October 1 when track is closed all day for Hardly Strictly Bluegrass"
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
          console.log("Failed to match Fall array prelude", r);
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
        } else if (reParser(/EXCEPT:/gi)(s)) {
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
    daily(rule.start_date, rule.end_date, (date) => {
      for (const p of predicates) {
        const r = p(date);
        if (r) {
          return r;
        }
      }
      return [dateInterval(date, true)];
    }),
  );
}

const RECOGNIZERS = [
  recognizer(
    /^(The Cycle Track will remain open - Polo Fields Closed|The Cycle Track Will be Open Mondays through Sundays all day)$/i,
    (rule) => [dayInterval(rule.start_date, rule.end_date, true)],
  ),
  recognizer(
    /^The Cycle Track will be closed for Outside Lands Load in, Event and Load Out$/i,
    (rule) => [
      dayInterval(rule.start_date, rule.end_date, false, "Outside Lands"),
    ],
  ),
  recognizer(
    /^The Cycle Track (?:will be )?Closed for (?<comment>(?:\w+ )+)from (?<start>\d+) to (?<end>\d+) (?<ampm>[ap])\.m\.$/i,
    (rule, m) => {
      const hour = /p/i.test(m.groups?.ampm ?? "") ? 12 : 0;
      const start_hour = (parseInt(m.groups?.start ?? "", 10) % 12) + hour;
      const end_hour = parseInt(m.groups?.end ?? "", 10) + hour;
      const comment = m.groups?.comment.trim();

      return daily(rule.start_date, rule.end_date, (date) =>
        closedIntervals(date, start_hour, end_hour, comment),
      );
    },
  ),
  recognizer(
    /^The Cycle Track will be open after 5:30 p.m. on Saturday and after 7:30 p.m. on Sunday.$/i,
    (rule) =>
      daily(rule.start_date, rule.end_date, (date) => {
        const weekday = date.getDay();
        if (weekday === WEEKDAYS.Sat) {
          return closedMinuteIntervals(date, 0, toMinute(17, 30));
        } else if (weekday === WEEKDAYS.Sun) {
          return closedMinuteIntervals(date, 0, toMinute(19, 30));
        } else {
          return [dateInterval(date, false)];
        }
      }),
  ),
  recognizer(
    /^The Cycle Track will remain open - Polo Fields Closed Except on Tuesdays and Thursdays from 6:30 p\.m\. to 8:45 p\.m\. for adult sports programming\.$/i,
    (rule) =>
      daily(rule.start_date, rule.end_date, (date) => {
        const weekday = date.getDay();
        if (weekday === WEEKDAYS.Tue || weekday === WEEKDAYS.Thu) {
          return closedMinuteIntervals(
            date,
            toMinute(18, 30),
            toMinute(20, 45),
            "adult sports programming",
          );
        } else {
          return [dateInterval(date, true)];
        }
      }),
  ),
  recognizer(
    /^Youth and Adult Sports Programs Begin\. The Cycle Track Will be Open: Mondays all day Tuesdays\*, Wednesdays, Thursdays\* and Fridays before 2 p\.m\. and after 6:45 p\.m\. \(\*On Tuesdays beginning March 14, the cycling track will be open after 8:45 p\.m\. On Thursdays beginning March 30, the track will be open after 8:45 p\.m\.\) Saturdays and Sundays before 7 a\.m\. and after 6:45 p\.m\. EXCEPT Saturday, March 4 where track will be open all day and Wednesday, April 26, 7:30am through Friday, April 28, when the track will be closed for maintenance\. The track will reopen Saturday, April 29 after 6:45pm\./i,
    (rule) =>
      /*
      Youth and Adult Sports Programs Begin.
      The Cycle Track Will be Open: Mondays all day
      Tuesdays*, Wednesdays, Thursdays* and Fridays before 2 p.m. and after 6:45 p.m.
      (*On Tuesdays beginning March 14, the cycling track will be open after 8:45 p.m. On Thursdays beginning March 30, the track will be open after 8:45 p.m.)
      Saturdays and Sundays before 7 a.m. and after 6:45 p.m. EXCEPT Saturday, March 4 where track will be open all day
      and Wednesday, April 26, 7:30am through Friday, April 28, when the track will be closed for maintenance.
      The track will reopen Saturday, April 29 after 6:45pm.
      */
      daily(rule.start_date, rule.end_date, (date) => {
        const fmtDate = shortDateStyle.format(date);
        const weekday = date.getDay();
        const march4 = `${date.getFullYear()}-03-04`;
        const march14 = `${date.getFullYear()}-03-14`;
        const march30 = `${date.getFullYear()}-03-30`;
        const apr26 = `${date.getFullYear()}-04-26`;
        const apr29 = `${date.getFullYear()}-04-29`;
        const comment = "Youth and Adult Sports Programs";
        if (fmtDate >= apr26 && fmtDate <= apr29) {
          return closedTimestampIntervals(
            date,
            addMinutes(parseDate(apr26), toMinute(7, 30)),
            addMinutes(parseDate(apr29), toMinute(18, 45)),
            "maintenance",
          );
        }
        if (weekday === WEEKDAYS.Mon || fmtDate === march4) {
          return [dateInterval(date, true)];
        }
        if (
          [WEEKDAYS.Tue, WEEKDAYS.Wed, WEEKDAYS.Thu, WEEKDAYS.Fri].includes(
            weekday,
          )
        ) {
          let end_minute = toMinute(18, 45);
          if (
            (weekday === WEEKDAYS.Tue && fmtDate >= march14) ||
            (weekday === WEEKDAYS.Thu && fmtDate >= march30)
          ) {
            end_minute = toMinute(20, 45);
          }
          return closedMinuteIntervals(
            date,
            toMinute(14, 0),
            end_minute,
            comment,
          );
        }
        if (weekday === WEEKDAYS.Sat || weekday === WEEKDAYS.Sun) {
          return closedMinuteIntervals(
            date,
            toMinute(7, 0),
            toMinute(18, 45),
            comment,
          );
        }
        return [dateInterval(date, true)];
      }),
  ),
  summerRecognizer,
  fallRecognizer,
];

function nlpRule(rule: UnknownRules): UnknownRules | KnownRules {
  for (const r of RECOGNIZERS) {
    const known = r(rule);
    if (known) {
      return known;
    }
  }
  return rule;
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

export type ScrapeResult = Year<UnknownRules | KnownRules>[];

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
  getResult(): ScrapeResult {
    return this.years.map((y) => ({
      ...y,
      rules: y.rules.reduce(reduceYearRules(y.year), []).map(nlpRule),
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
  const year = parseInt(date.split("-")[0], 10);
  for (const sched of result) {
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
  } else {
    await env.DB.prepare(
      `INSERT INTO scrape_results (created_at, scrape_results_json) VALUES (?, ?)`,
    )
      .bind(created_at, scrape_results_json)
      .run();
    if (log) {
      console.log(`Inserted new scrape result at ${created_at}`);
    }
    return { created_at, scrape_results: result };
  }
}

export async function handleCron(
  event: ScheduledController,
  env: Bindings,
): Promise<void> {
  await refreshScrapeResult(env, { log: true });
}
