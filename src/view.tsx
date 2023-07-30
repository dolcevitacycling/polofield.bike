import { Context } from "hono";
import { Bindings } from "./types";
import {
  KnownRules,
  POLO_URL,
  RuleInterval,
  ScrapeResult,
  addDays,
  intervalsForDate,
  parseDate,
  scrapePoloURL,
  shortDateStyle,
  toMinute,
} from "./cron";
import { html } from "hono/html";
import SunCalc from "suncalc";

export const POLO_LAT = 37.76815;
export const POLO_LON = -122.4927;

interface Props {
  date: string;
  children?: unknown;
}

function Layout(props: Props) {
  return html`<!doctype html>
    <html>
      <head>
        <title>Polo Field Schedule for ${friendlyDate(props.date)}</title>
      </head>
      <style>
        ul {
          list-style-type: none;
          padding-left: 0;
          display: flex;
        }
        h1 {
          text-align: center;
        }
        li {
          box-sizing: border-box;
          margin-top: 1em;
          position: relative;
          font-weight: bold;
          font-size: 2em;
          height: 4em;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .time {
          position: absolute;
          top: -0.5em;
          left: -0.25em;
          transform: translate(0, -100%);
        }
        .open {
          background-color: #2dc937;
          border: 10px solid #2dc937;
        }
        .closed {
          background-color: #cc3232;
          border: 10px solid #cc3232;
          background: repeating-linear-gradient(
            135deg,
            #cc3232,
            #cc3232 10px,
            #ffffff 10px,
            #ffffff 20px
          );
        }
        .closed .copy {
          background-color: rgba(255, 255, 255, 0.8);
          padding: 5px;
        }
        .background {
          position: absolute;
          top: -10px;
          bottom: -10px;
          left: -10px;
          right: -10px;
        }
      </style>
      <body>
        <h1>
          <a href="${POLO_URL}"
            >Ethan Boyes Cycle Track @ GGP Polo Field Schedule</a
          >
        </h1>
        ${props.children}
      </body>
    </html>`;
}

const usFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
function friendlyDate(date: string) {
  return usFormat.format(parseDate(date));
}
function friendlyTime(time: string) {
  const [h, m] = time.split(":");
  const hh = parseInt(h, 10);
  const h12 = hh % 12;
  const ampm = h12 === hh ? "am" : "pm";
  return `${h12 === 0 ? 12 : h12}${m === "00" ? "" : `:${m}`}${ampm}`;
}
function friendlyTimeStart(date: string, time: string) {
  return time === "00:00" ? friendlyDate(date) : friendlyTime(time);
}

function friendlyTimeEnd(time: string) {
  const mins = timeToMinutes(time) + 1;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const h12 = hh % 12;
  const ampm = h12 === hh ? "am" : "pm";
  return `${h12 === 0 ? 12 : h12}${
    mm === 0 ? "" : `:${mm.toString().padStart(2, "0")}`
  }${ampm}`;
}

function friendlyTimeSpan(hStart: string, hEnd: string) {
  if (hStart === "00:00" && hEnd === "23:59") {
    return "all day";
  } else if (hStart === "00:00") {
    return `until ${friendlyTimeEnd(hEnd)}`;
  } else if (hEnd === "23:59") {
    return `from ${friendlyTime(hStart)}`;
  } else {
    return `from ${friendlyTime(hStart)} to ${friendlyTimeEnd(hEnd)}`;
  }
}

const skinTypes = [
  "", // default
  "\u{1f3fb}", // skin type 1-2
  "\u{1f3fc}", // skin type 3
  "\u{1f3fd}", // skin type 4
  "\u{1f3fe}", // skin type 5
  "\u{1f3ff}", // skin type 6
];
const cyclist = "\u{1f6b4}";
const genders = [
  "", // person
  "\u{200d}\u{2642}\u{FE0F}", // man
  "\u{200d}\u{2640}\u{FE0F}", // woman
];

function selectRandom(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomCyclist() {
  return `${cyclist}${selectRandom(skinTypes)}${selectRandom(genders)}`;
}

function DayPage(props: {
  date: string;
  ruleIntervals: ReturnType<typeof intervalsForDate>;
}) {
  return (
    <Layout date={props.date}>
      <Rules {...props} />
    </Layout>
  );
}

function WeekPage(props: { date: string; result: ScrapeResult }) {
  const { date, result } = props;
  const d = parseDate(date);

  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals) {
    return null;
  }

  return (
    <Layout date={date}>
      {Array.from({ length: 90 }, (_, i) => {
        const date = shortDateStyle.format(addDays(d, i));
        const ruleIntervals = intervalsForDate(result, date);
        if (!ruleIntervals) {
          return null;
        }
        return <Rules date={date} ruleIntervals={ruleIntervals} />;
      })}
    </Layout>
  );
}

function clampStart(date: string, timestamp: string) {
  const [tsDate, tsTime] = timestamp.split(" ");
  return date === tsDate ? tsTime : "00:00";
}
function clampEnd(date: string, timestamp: string) {
  const [tsDate, tsTime] = timestamp.split(" ");
  return date === tsDate ? tsTime : "23:59";
}
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
function intervalMinutes(hStart: string, hEnd: string) {
  return timeToMinutes(hEnd) - timeToMinutes(hStart);
}

function sunGradient(tStart: number, tEnd: number, sunProps: SunProps): string {
  const duration = tEnd - tStart;
  const rel = (k: keyof SunProps) => 100 * Math.min(1, (Math.max(0, timeToMinutes(sunProps[k]) - tStart) / duration));
  const intervals = [
    'to right',
    `rgba(0, 0, 0, 0.1) 0% ${rel("sunrise")}%`,
    `rgba(0, 0, 0, 0) ${rel("sunriseEnd")}% ${rel("sunsetStart")}%`,
    `rgba(0, 0, 0, 0.1) ${rel("sunset")}% 100%`,
  ];
  return `linear-gradient(${intervals.join(", ")})`;
}

function Interval(props: {
  date: string;
  rule: KnownRules;
  interval: RuleInterval;
  sunrise: string;
  sunriseEnd: string;
  sunsetStart: string;
  sunset: string;
}) {
  const { date, rule, interval, sunrise, sunriseEnd, sunsetStart, sunset } = props;
  const hStart = clampStart(date, interval.start_timestamp);
  const hEnd = clampEnd(date, interval.end_timestamp);
  const tStart = timeToMinutes(hStart);
  const tEnd = timeToMinutes(hEnd);

  const { open } = interval;
  const title = `${open ? "Open" : "Closed"} ${friendlyTimeSpan(hStart, hEnd)}${
    interval.comment ? ` for ${interval.comment}` : ""
  }`;
  return (
    <li
      class={open ? "open" : "closed"}
      style={`flex: ${intervalMinutes(hStart, hEnd)}`}
      title={title}
      data-sunrise={sunrise}
      data-sunrise-end={sunriseEnd}
      data-sunset-start={sunsetStart}
      data-sunset={sunset}
    >
      {open ? (
        <div class="background" style={`background: ${sunGradient(tStart, tEnd, props)};`}></div>
      ) : null}
      <div class="time">{friendlyTimeStart(date, hStart)}</div>
      <span class="copy">{open ? `${randomCyclist()}` : "🚳"}</span>
    </li>
  );
}

const tzTimeFormat = new Intl.DateTimeFormat("en-US", {
  hourCycle: "h24",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

const SUN_KEYS = ["sunrise", "sunriseEnd", "sunset", "sunsetStart"] as const;
type SunProps = Record<typeof SUN_KEYS[number], string>;

function Intervals(props: {
  date: string;
  rule: KnownRules;
  intervals: RuleInterval[];
}) {
  const { date, rule, intervals } = props;
  const calc = SunCalc.getTimes(parseDate(date), POLO_LAT, POLO_LON);
  const sunProps = SUN_KEYS.reduce((acc, k) => { acc[k] = tzTimeFormat.format(calc[k]); return acc; }, {} as SunProps);
  return (
    <ul>
      {intervals.map((interval) => (
        <Interval {...sunProps} {...{  date, rule, interval }} />
      ))}
    </ul>
  );
}

function Rules(props: {
  date: string;
  ruleIntervals: ReturnType<typeof intervalsForDate>;
}) {
  if (!props.ruleIntervals) {
    return (
      <p>
        No rules found for {props.date}, please consult{" "}
        <a href="${POLO_URL}">Polo Field Schedule</a>!
      </p>
    );
  } else if (props.ruleIntervals.type === "unknown") {
    const { rule } = props.ruleIntervals;
    return (
      <div>
        <p>
          We don't quite understand for rules found for{" "}
          {friendlyDate(props.date)} yet, please consult{" "}
          <a href="${POLO_URL}">Polo Field Schedule</a>!
        </p>
        <h2>{rule.text}</h2>
        <h3>
          {friendlyDate(rule.start_date)} to {friendlyDate(rule.end_date)}
        </h3>
        <ul>
          {rule.rules.map((t) => (
            <li>{t}</li>
          ))}
        </ul>
      </div>
    );
  } else if (props.ruleIntervals.type === "known") {
    return <Intervals date={props.date} {...props.ruleIntervals} />;
  } else {
    throw new Error("unreachable");
  }
}

export async function viewWeek(
  c: Context<{ Bindings: Bindings }>,
  date: string,
) {
  const result = await scrapePoloURL();
  const page = WeekPage({ date, result });
  if (!page) {
    return c.notFound();
  }
  return c.html(page, 200);
}

export default async function view(
  c: Context<{ Bindings: Bindings }>,
  date: string,
) {
  const result = await scrapePoloURL();
  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals) {
    return c.notFound();
  }
  return c.html(DayPage({ date, ruleIntervals }), 200);
}
