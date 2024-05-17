import type {
  Year,
  ScrapeDebugResult,
  ScrapeResult,
  RecognizerRules,
  KnownRules,
  RuleInterval,
} from "./cron";
import { toMinute } from "./dates";
import {
  apSecond,
  ensureEndParsed,
  mapParser,
  parseAll,
  parseFirst,
  stream,
  reParser,
} from "./parsing";
import { FieldRainoutInfo } from "./scrapeFieldRainoutInfo";

const CALENDAR_ID = 41;

function getCalendarUrl(startYear: number, endYear: number) {
  return `https://www.sfrecpark.org/calendar.aspx?Keywords=&startDate=01/01/${startYear}&enddate=12/31/${endYear}&CID=${CALENDAR_ID}&showPastEvents=true`;
}

const thisYearStyle = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: "America/Los_Angeles",
});

function getThisYear(): number {
  return +thisYearStyle.format(new Date());
}

export function currentCalendarUrl() {
  const year = getThisYear();
  return getCalendarUrl(year, year + 1);
}

export interface CalendarEntry {
  name: string;
  startDate: string;
  description: string;
  subHeaderDate: string;
  headingName: string;
}

export interface CalendarDate {
  date: string;
  entries: CalendarEntry[];
}

const CalendarWriters = {
  name(s: string, entry: CalendarEntry) {
    entry.name += s;
  },
  startDate(s: string, entry: CalendarEntry) {
    entry.startDate += s;
  },
  description(s: string, entry: CalendarEntry) {
    entry.description += s;
  },
  subHeaderDate(s: string, entry: CalendarEntry) {
    entry.subHeaderDate += s;
  },
  headingName(s: string, entry: CalendarEntry) {
    entry.headingName += s;
  },
};

type ScraperCopyState = [
  (s: string, entry: CalendarEntry) => void,
  CalendarEntry,
];
type ScraperState = "initial" | "calendar" | "ol" | "done" | ScraperCopyState;
const nullWriter = (s: string, entry: CalendarEntry) => {};

function calendarRecognizer() {
  return undefined;
}

interface ParsedName {
  open: boolean;
  startMinute: number;
  endMinute: number;
}

const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap](?:\.m\.|m))?/gi;
export const ctxTimeToMinuteParser = parseFirst(
  mapParser(
    reParser(TIME_RE),
    (result) =>
      ({
        value: toMinute(
          (parseInt(result[1], 10) % 12) + (/p/i.test(result[3]) ? 12 : 0),
          parseInt(result[2] ?? "0", 10),
        ),
        ampm: typeof result[3] === "string",
      }) as const,
  ),
  mapParser(
    reParser(/noon/gi),
    () => ({ value: noonMinutes, ampm: true }) as const,
  ),
);
const noonMinutes = toMinute(12, 0);

function applyTime(
  cur: { value: number; ampm: boolean },
  ctx: { value: number; ampm: boolean },
) {
  return (
    cur.value +
    (!cur.ampm &&
    ctx.ampm &&
    ctx.value >= noonMinutes &&
    cur.value < noonMinutes
      ? noonMinutes
      : 0)
  );
}

export const ctxMinuteRangeParser = mapParser(
  parseAll(
    ctxTimeToMinuteParser,
    reParser(/\s*(to|-|-)\s*/gi),
    ctxTimeToMinuteParser,
  ),
  ([ctx_start_minute, _delim, ctx_end_minute]) =>
    ({
      startMinute: applyTime(ctx_start_minute, ctx_end_minute),
      endMinute: applyTime(ctx_end_minute, ctx_start_minute),
    }) as const,
);

export const timeToMinuteParser = mapParser(
  ctxTimeToMinuteParser,
  (result) => result.value,
);

export const timeSpanReParser = parseFirst(
  // "all day"
  mapParser(reParser(/\s*all day\s*/gi), () => {
    return {
      startMinute: 0,
      endMinute: toMinute(24, 0),
    } as const;
  }),
  // "until 2 p.m."
  mapParser(
    apSecond(reParser(/\s*until\s+/gi), timeToMinuteParser),
    (endMinute) => ({ endMinute }) as const,
  ),
  // "after 10 a.m."
  mapParser(
    apSecond(reParser(/\s*after\s+/gi), timeToMinuteParser),
    (startMinute) => ({ startMinute }) as const,
  ),
  // "2-10 p.m.", "5 a.m. to 2 p.m."
  ctxMinuteRangeParser,
);

export const cycleTrackOpenParser = mapParser(
  reParser(/(?:cycle|cycling) track (?:(open)|closed)\s*/gi),
  (result) => !!result[1],
);

export const cycleTrackParser = ensureEndParsed(
  mapParser(
    parseAll(cycleTrackOpenParser, timeSpanReParser),
    ([open, range]) =>
      ({
        open,
        ...range,
      }) as const,
  ),
);

const onlyOpenParser = ensureEndParsed(cycleTrackOpenParser);

export const subheaderDateParser = ensureEndParsed(
  apSecond(reParser(/\w+\s+\d+,\s+\d+,\s+/gi), ctxMinuteRangeParser),
);

const MONTHS = Object.fromEntries(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((m, i) => [m, String(i + 1).padStart(2, "0")]),
);
export const subHeaderDateOnlyParser = mapParser(
  reParser(
    new RegExp(
      `(${Object.keys(MONTHS).join("|")}) ${/(\d{1,2}), (\d{4}), (?:(All Day)|(\d{1,2}):(\d{2}) ([AP]M))/.source}`,
      "gi",
    ),
  ),
  (res) => {
    const [, month, day, year, allDay, hour, min, ampm] = res;
    return [
      `${year.padStart(4, "0")}-${MONTHS[month]}-${day.padStart(2, "0")}`,
      allDay
        ? "00:00"
        : `${String(parseInt(hour, 10) + (ampm === "PM" ? 12 : 0)).padStart(2, "0")}:${min.padStart(2, "0")}`,
    ].join("T");
  },
);

function transformedSubHeaderDate(date: string): string {
  const d2 = subHeaderDateOnlyParser(stream(date));
  if (!d2) {
    throw new Error("Invalid subHeaderDate " + date);
  }
  return d2.result;
}

function fixEvent({
  name,
  startDate,
  description,
  subHeaderDate,
  headingName,
}: CalendarEntry) {
  const after = subHeaderDate
    .replaceAll(/&nbsp;|&thinsp;/gi, " ")
    .replaceAll(/\s+/g, " ");
  if (/&/gi.test(after)) {
    console.error(
      `Invalid subHeaderDate: ${JSON.stringify(subHeaderDate)} -> ${JSON.stringify(after)}`,
    );
  }
  return {
    name: name || headingName,
    startDate: startDate || transformedSubHeaderDate(after),
    description,
    subHeaderDate: after,
    headingName,
  };
}

function nameParser(entry: CalendarEntry) {
  const s = stream(entry.name);
  const result = cycleTrackParser(s)?.result;
  if (!result) {
    const r2 = onlyOpenParser(s);
    const d2 = subheaderDateParser(stream(entry.subHeaderDate));
    if (r2 && d2) {
      return { open: r2.result, ...d2.result };
    }
    throw new Error(
      `Invalid name: ${JSON.stringify(entry)} r2=${r2?.result} d2=${d2?.result}`,
    );
  }
  return result;
}

function formatDateMinute(date: string, minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${date} ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function fillEntry(
  cur: ReturnType<typeof nameParser>,
  prev: ParsedName | null,
) {
  return {
    open: cur.open,
    startMinute:
      "startMinute" in cur ? cur.startMinute : prev ? prev.endMinute - 1 : 0,
    endMinute: "endMinute" in cur ? cur.endMinute - 1 : toMinute(23, 59),
  };
}

function getIntervals(date: CalendarDate, fieldRainedOut: boolean) {
  const intervals: RuleInterval[] = [];
  if (fieldRainedOut) {
    intervals.push({
      open: true,
      comment: "Field Rained Out, Cycle Track Open All Day",
      start_timestamp: formatDateMinute(date.date, toMinute(0, 0)),
      end_timestamp: formatDateMinute(date.date, toMinute(23, 59)),
    });
  } else {
    let lastEntry: ParsedName | null = null;
    for (const entry of date.entries) {
      const p = fillEntry(nameParser(entry), lastEntry);

      if (!lastEntry) {
        if (p.startMinute > 0) {
          intervals.push({
            open: !p.open,
            start_timestamp: formatDateMinute(date.date, 0),
            end_timestamp: formatDateMinute(date.date, p.startMinute - 1),
          });
        }
      } else if (p.open === lastEntry.open) {
        intervals.push({
          open: !p.open,
          start_timestamp: formatDateMinute(date.date, lastEntry.endMinute + 1),
          end_timestamp: formatDateMinute(date.date, p.startMinute - 1),
        });
      }
      intervals.push({
        open: p.open,
        start_timestamp: formatDateMinute(date.date, p.startMinute),
        end_timestamp: formatDateMinute(date.date, p.endMinute),
      });
      lastEntry = p;
    }
    if (lastEntry && lastEntry.endMinute < toMinute(23, 59)) {
      intervals.push({
        open: !lastEntry.open,
        start_timestamp: formatDateMinute(date.date, lastEntry.endMinute + 1),
        end_timestamp: formatDateMinute(date.date, toMinute(23, 59)),
      });
    }
  }
  return intervals;
}

function formatRules(date: CalendarDate, fieldRainedOut: boolean) {
  const rules = date.entries.map(
    (e) => `${e.name}\t${e.startDate}\t${e.description}\t${e.subHeaderDate}`,
  );
  if (fieldRainedOut) {
    rules.push(`Field Rained Out\t${date.date}\t\t`);
  }
  return rules;
}

function recognizeCalendarDate(
  calendarDate: CalendarDate,
  fieldRainoutInfo: FieldRainoutInfo,
): RecognizerRules {
  const { date } = calendarDate;
  const fieldRainedOut = fieldRainoutInfo[date]?.trackOpen ?? false;
  const rules: KnownRules = {
    type: "known_rules",
    text: date,
    start_date: date,
    end_date: date,
    intervals: getIntervals(calendarDate, fieldRainedOut),
    rules: formatRules(calendarDate, fieldRainedOut),
  };
  return { recognizer: calendarRecognizer, rules };
}

export class CalendarScraper implements HTMLRewriterElementContentHandlers {
  fieldRainoutInfo: FieldRainoutInfo = {};
  state: ScraperState = "initial";
  years: Year<CalendarDate>[] = [];
  getDebugResult(): ScrapeDebugResult {
    return this.years.map((y) => ({
      ...y,
      rules: y.rules.map((r) =>
        recognizeCalendarDate(r, this.fieldRainoutInfo),
      ),
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
          element.tagName === "div" &&
          element.getAttribute("id") === `CID${CALENDAR_ID}`
        ) {
          this.state = "calendar";
        }
        break;
      }
      case "calendar": {
        if (element.tagName === "ol") {
          this.state = "ol";
          element.onEndTag(() => {
            this.state = "done";
          });
        }
        break;
      }
      case "ol": {
        if (element.tagName === "li") {
          this.state = [
            nullWriter,
            {
              name: "",
              startDate: "",
              description: "",
              subHeaderDate: "",
              headingName: "",
            },
          ];
          element.onEndTag(() => {
            if (!Array.isArray(this.state)) {
              throw new Error(`Invalid state: ${JSON.stringify(this.state)}`);
            }
            const fixedEvent = fixEvent(this.state[1]);
            if (fixedEvent.name === "") {
              console.log(fixedEvent);
              throw new Error(`Invalid state ${JSON.stringify(this.state)}`);
            }
            this.addEvent(fixedEvent);
            this.state = "ol";
          });
        }
        break;
      }
      case "done": {
        break;
      }
      default: {
        if (element.tagName === "span") {
          const prop = element.getAttribute("itemprop");
          switch (prop) {
            case "name":
            case "startDate":
            case "description":
              // itemprop="name" shows up in the location as well
              if (this.state[1][prop] === "") {
                this.state[0] = CalendarWriters[prop];
                element.onEndTag(() => {
                  if (Array.isArray(this.state)) {
                    this.state[0] = nullWriter;
                  }
                });
              }
            default: {
            }
          }
        } else if (
          element.tagName === "div" &&
          element.getAttribute("class") === "date"
        ) {
          this.state[0] = CalendarWriters.subHeaderDate;
          element.onEndTag(() => {
            if (Array.isArray(this.state)) {
              this.state[0] = nullWriter;
            }
          });
        } else if (
          element.tagName === "a" &&
          /^eventTitle_/.test(element.getAttribute("id") ?? "")
        ) {
          this.state[0] = CalendarWriters.headingName;
          element.onEndTag(() => {
            if (Array.isArray(this.state)) {
              this.state[0] = nullWriter;
            }
          });
        }
        element.remove();
        break;
      }
    }
  }
  text(element: Text) {
    if (Array.isArray(this.state)) {
      this.state[0](element.text, this.state[1]);
    }
    element.remove();
  }
  addEvent(event: CalendarEntry) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(event.startDate);
    if (!m) {
      throw new Error(`Invalid date: ${JSON.stringify(event, null, 2)}`);
    }
    const date = m[1];
    const year = +date.substring(0, 4);
    const curYear = this.years[this.years.length - 1];
    if (curYear && curYear.year === year) {
      const curDate = curYear.rules[curYear.rules.length - 1];
      if (curDate && curDate.date === date) {
        curDate.entries.push(event);
      } else {
        curYear.rules.push({ date, entries: [event] });
      }
    } else {
      this.years.push({
        type: "year",
        year,
        rules: [{ date, entries: [event] }],
      });
    }
  }
}
