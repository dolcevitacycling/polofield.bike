import { Context } from "hono";
import { Bindings } from "./types";
import { CachedScrapeResult, POLO_URL, cachedScrapeResult } from "./cron";
import {
  shortTimeStyle,
  addMinutes,
  parseDate,
  toMinute,
  addDays,
} from "./dates";

function prefix(filter: FeedParameters) {
  return `BEGIN:VCALENDAR
PRODID:-//Dolce Vita Cycling//polofield.bike 1.0//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
${text(
  "X-WR-CALNAME",
  `GGP Polo Field Cycle Track ${
    filter.open === undefined
      ? "Schedule"
      : filter.open
        ? "Availability"
        : "Closures"
  }`,
)}
X-WR-TIMEZONE:America/Los_Angeles
X-WR-CALDESC:https://sfrecpark.org/526/Polo-Field-Usage
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
X-LIC-LOCATION:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;
}
const POSTFIX = `END:VCALENDAR`;
function feedText(filter: FeedParameters, events: Event[]) {
  return [prefix(filter), ...events.flatMap(mapEvent(filter)), POSTFIX, ""]
    .join("\r\n")
    .replace(/\r?\n/g, "\r\n");
}

function localTs(date: Date) {
  return `${shortTimeStyle
    .format(date)
    .replace(" ", "T")
    .replace(/[-:]/g, "")}00`;
}

function text(key: string, value: string) {
  return fold75(`${key}:${escapeText(value)}`);
}

function escapeText(value: string) {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

function break75(input: string): readonly [line: string, rest: string] {
  if (input.length <= 75) {
    return [input, ""];
  }
  let index = input.lastIndexOf(" ", 75);
  if (index === -1) {
    index = 75;
  }
  return [input.slice(0, index), input.slice(index)];
}

function fold75(input: string): string {
  const lines = [];
  while (input.length > 0) {
    const r = break75(input);
    lines.push(r[0]);
    input = r[1];
  }
  return lines.join("\r\n ");
}

interface Event {
  readonly start: Date;
  readonly end: Date;
  readonly created: Date;
  readonly modified: Date;
  readonly open: boolean;
  readonly comment?: string;
  readonly unknown: boolean;
}

function uid(event: Event): string {
  return `${localTs(event.start)}-${localTs(event.end)}@polofield.bike`;
}

function utc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function comment(event: Event): string {
  return event.open
    ? "Cycle track open"
    : event.comment
      ? `Cycle track closed for ${event.comment}`
      : "Cycle track closed";
}

function eventText(event: Event): string {
  return `BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:${localTs(event.start)}
DTEND;TZID=America/Los_Angeles:${localTs(event.end)}
DTSTAMP:${utc(event.modified)}
UID:${uid(event)}
CREATED:${utc(event.created)}
LAST-MODIFIED:${utc(event.modified)}
SEQUENCE:${sequence(event)}
STATUS:CONFIRMED
${text("SUMMARY", comment(event))}
TRANSP:OPAQUE
END:VEVENT`;
}

function sequence(event: Event) {
  return 0;
}

function parseTimestamp(timestamp: string): Date {
  const [d, hhmm] = timestamp.split(" ");
  const [hh, mm] = hhmm.split(":");
  return addMinutes(parseDate(d), toMinute(parseInt(hh, 10), parseInt(mm, 10)));
}

function dayMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function shouldJoin(a: Event, b: Event): boolean {
  return (
    a.open === b.open &&
    a.unknown === b.unknown &&
    a.comment === b.comment &&
    a.end.getTime() === b.start.getTime() &&
    // Only join entire days (12am-12am, 12am-12am)
    dayMinutes(a.start) === 0 &&
    dayMinutes(b.start) === 0 &&
    dayMinutes(b.end) === 0
  );
}

function parseEvents({
  created_at,
  scrape_results,
}: CachedScrapeResult): Event[] {
  const events: Event[] = [];
  const created = new Date(created_at);
  const modified = created;
  function pushEvent(event: Event) {
    const lastEvent = events[events.length - 1];
    if (lastEvent && shouldJoin(lastEvent, event)) {
      events[events.length - 1] = { ...event, start: lastEvent.start };
    } else {
      events.push(event);
    }
  }
  for (const { rules } of scrape_results) {
    for (const rule of rules) {
      if (rule.type === "unknown_rules") {
        pushEvent({
          start: parseDate(rule.start_date),
          end: addDays(parseDate(rule.end_date), 1),
          created,
          modified,
          comment: `Unknown cycle track status, see ${POLO_URL}`,
          unknown: true,
          open: false,
        });
      } else if (rule.type === "known_rules") {
        for (const {
          open,
          start_timestamp,
          end_timestamp,
          comment,
        } of rule.intervals) {
          pushEvent({
            start: parseTimestamp(start_timestamp),
            end: addMinutes(parseTimestamp(end_timestamp), 1),
            comment,
            created,
            modified,
            unknown: false,
            open,
          });
        }
      }
    }
  }
  return events;
}

export interface FeedParameters {
  readonly open?: boolean | undefined;
}

export function calendarView(filter: FeedParameters) {
  return async (c: Context<{ Bindings: Bindings }>) => {
    return c.redirect(
      filter.open === undefined
        ? "https://calendar.google.com/calendar/embed?src=gunjrgf8u7adb8tklsjip1onkgq8jt4b%40import.calendar.google.com&ctz=America%2FLos_Angeles"
        : filter.open
          ? "https://calendar.google.com/calendar/embed?src=gbkbujrfqfvtqt9hehn2lj5j3kjeqs7i%40import.calendar.google.com&ctz=America%2FLos_Angeles"
          : "https://calendar.google.com/calendar/embed?src=c3eifni8meiomobvdguo8ahoumb8b2f6%40import.calendar.google.com&ctz=America%2FLos_Angeles",
    );
  };
}

function basename(filter: FeedParameters) {
  return filter.open === undefined
    ? "calendar"
    : filter.open
      ? "open"
      : "closed";
}

function mapEvent(filter: FeedParameters) {
  return filter.open === undefined
    ? (event: Event) => [eventText(event)]
    : (event: Event) =>
        event.unknown || event.open === filter.open ? [eventText(event)] : [];
}

export default function icalFeed(filter: FeedParameters) {
  return async (c: Context<{ Bindings: Bindings }>) => {
    return c.text(
      feedText(filter, parseEvents(await cachedScrapeResult(c.env))),
      200,
      {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${basename(filter)}.ics"`,
      },
    );
  };
}
