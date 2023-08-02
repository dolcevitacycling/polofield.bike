import { Context } from "hono";
import { Bindings } from "./types";
import {
  KnownRules,
  POLO_URL,
  RuleInterval,
  ScrapeResult,
  cachedScrapeResult,
  intervalsForDate,
} from "./cron";
import { html } from "hono/html";
import SunCalc from "suncalc";
import {
  parseDate,
  shortDateStyle,
  addDays,
  clampEnd,
  clampStart,
  friendlyDate,
  friendlyTime,
  friendlyTimeSpan,
  friendlyTimeStart,
  intervalMinutes,
  timeToMinutes,
} from "./dates";

export const POLO_LAT = 37.76815;
export const POLO_LON = -122.4927;

interface Props {
  date: string;
  children?: unknown;
  titlePrefix?: string;
}

function linkRelIcon(icon?: string) {
  return icon
    ? html`<link
        rel="icon"
        href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${icon.trim()}</text></svg>"
      /> `
    : "";
}

function Layout(props: Props) {
  return html`<!doctype html>
    <html>
      <head>
        <title>Polo Field Schedule for ${friendlyDate(props.date)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${linkRelIcon(props.titlePrefix)}
      </head>
      <style>
        * {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        }
        body {
          margin: 24px;
        }
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
        li > button {
          box-sizing: border-box;
          position: relative;
          border: none;
          background: none;
          font-size: 2em;
          font-weight: inherit;
          cursor: pointer;
          width: 100%;
          height: 100%;
          padding: 0;
          text-align: center;
          -moz-appearance: none;
          -webkit-appearance: none;
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
          position: relative;
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
          position: relative;
          z-index: 0;
        }
        .closed .copy:before {
          z-index: -1;
          content: "";
          position: absolute;
          width: 1em;
          height: 1em;
          left: 50%;
          top: 50%;
          border-radius: 100%;
          transform: translate(-50%, -50%);
          background-color: #fff;
        }
        .background {
          position: absolute;
          top: -10px;
          bottom: -10px;
          left: -10px;
          right: -10px;
        }
        .no-underline {
          text-decoration: none;
        }
        .tooltip {
          position: absolute;
          top: 0;
          left: 0;
          width: max-content;
          background: #222;
          color: white;
          font-weight: bold;
          padding: 5px;
          border-radius: 4px;
          font-size: 90%;
        }
        .tooltip-arrow {
          position: absolute;
          background: #222;
          width: 8px;
          height: 8px;
          transform: rotate(45deg);
        }
        nav {
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5em;
        }
        nav a {
          position: relative;
        }
        nav a .base {
          font-size: 2em;
        }
        nav a .overlap {
          position: absolute;
          font-size: 1em;
          left: 50%;
          top: 60%;
          transform: translate(-50%, -50%);
        }
        @media only screen and (max-width: 480px) {
          body {
            margin: 12px;
            font-size: 10px;
          }
          .time {
            font-size: 12px;
            top: -1em;
            left: -0.75em;
          }
        }
      </style>
      <body>
        <h1>
          <a href="${POLO_URL}"
            >Ethan Boyes Cycle Track @ GGP Polo Field Schedule</a
          >
        </h1>
        <nav>
          <a
            href="/calendar/open"
            class="no-underline"
            title="Google Calendar of Cycle Track openings"
            ><span class="base">🗓️</span
            ><span class="overlap">${randomCyclist()}</span></a
          >
          |
          <a
            href="/calendar/closed"
            class="no-underline"
            title="Google Calendar of Cycle Track closures"
            ><span class="base">🗓️</span
            ><span class="overlap">${NO_BIKES}</span></a
          >
        </nav>
        ${props.children}
        <script type="module" src="/js/tooltip.mjs"></script>
      </body>
    </html>`;
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

function randomPersonType() {
  return `${selectRandom(skinTypes)}${selectRandom(genders)}`;
}

function selectRandom(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomShrug() {
  return `🤷🏼${randomPersonType()}`;
}

const NO_BIKES = "🚳";
const WARNING = "⚠️";

function randomCyclist() {
  return `${cyclist}${randomPersonType()}`;
}

function DayPage(props: {
  date: string;
  ruleIntervals: ReturnType<typeof intervalsForDate>;
}) {
  return (
    <Layout date={props.date} titlePrefix={titlePrefix(props.ruleIntervals)}>
      <Rules {...props} />
    </Layout>
  );
}

function titlePrefix(ruleIntervals: ReturnType<typeof intervalsForDate>) {
  if (ruleIntervals?.type === "unknown") {
    return `${randomShrug()} `;
  } else if (ruleIntervals?.type === "known") {
    const s = new Set(ruleIntervals.intervals.map((i) => i.open));
    return `${
      s.size > 1 ? WARNING : s.has(true) ? randomCyclist() : NO_BIKES
    } `;
  }
  return undefined;
}

function WeekPage(props: { date: string; result: ScrapeResult; days: number }) {
  const { date, result, days } = props;
  const d = parseDate(date);

  const ruleIntervals = intervalsForDate(result, date);

  return (
    <Layout date={date} titlePrefix={titlePrefix(ruleIntervals)}>
      {Array.from({ length: days }, (_, i) => {
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

function sunGradient(tStart: number, tEnd: number, sunProps: SunProps): string {
  const duration = tEnd - tStart;
  const rel = (k: keyof SunProps) =>
    100 *
    Math.min(1, Math.max(0, timeToMinutes(sunProps[k]) - tStart) / duration);
  const intervals = [
    "to right",
    `rgba(0, 0, 0, 0.3) 0% ${rel("sunrise")}%`,
    `rgba(0, 0, 0, 0) ${rel("sunriseEnd")}% ${rel("sunsetStart")}%`,
    `rgba(0, 0, 0, 0.3) ${rel("sunset")}% 100%`,
  ];
  return `linear-gradient(${intervals.join(", ")})`;
}

function sunTimes({
  hStart,
  hEnd,
  sunrise,
  sunsetStart,
}: Record<"hStart" | "hEnd" | "sunrise" | "sunsetStart", string>): string[] {
  const result = [];
  if (hStart <= sunrise) {
    result.push(`🌅 ${friendlyTime(sunrise)}`);
  }
  if (hEnd >= sunsetStart) {
    result.push(`🌉 ${friendlyTime(sunsetStart)}`);
  }
  return result;
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
  const { date, rule, interval, sunrise, sunriseEnd, sunsetStart, sunset } =
    props;
  const hStart = clampStart(date, interval.start_timestamp);
  const hEnd = clampEnd(date, interval.end_timestamp);
  const tStart = timeToMinutes(hStart);
  const tEnd = timeToMinutes(hEnd);
  const duration = intervalMinutes(hStart, hEnd) + 1;
  const percent = 100 * (duration / 1440);

  const { open } = interval;
  const title = open
    ? `Open ${friendlyTimeSpan(hStart, hEnd)}\n${sunTimes({
        hStart,
        hEnd,
        sunrise,
        sunsetStart,
      }).join("\n")}`
    : `Closed ${friendlyTimeSpan(hStart, hEnd)}${
        interval.comment ? `\n${interval.comment}` : ""
      }`;
  return (
    <li
      class={open ? "open" : "closed"}
      data-start={hStart}
      data-end={hEnd}
      data-minutes={duration}
      data-sunrise={sunrise}
      data-sunrise-end={sunriseEnd}
      data-sunset-start={sunsetStart}
      data-sunset={sunset}
      style={`flex: ${duration}; max-width: ${percent}%;`}
    >
      <div class="time">{friendlyTimeStart(date, hStart)}</div>
      {open ? (
        <div
          class="background"
          style={`background: ${sunGradient(tStart, tEnd, props)};`}
        ></div>
      ) : null}
      <button aria-label={title}>
        <span class="copy">{open ? randomCyclist() : NO_BIKES}</span>
      </button>
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
type SunProps = Record<(typeof SUN_KEYS)[number], string>;

function Intervals(props: {
  date: string;
  rule: KnownRules;
  intervals: RuleInterval[];
}) {
  const { date, rule, intervals } = props;
  const calc = SunCalc.getTimes(parseDate(date), POLO_LAT, POLO_LON);
  const sunProps = SUN_KEYS.reduce((acc, k) => {
    acc[k] = tzTimeFormat.format(calc[k]);
    return acc;
  }, {} as SunProps);
  return (
    <ul class="intervals" data-date={date}>
      {intervals.map((interval) => (
        <Interval {...sunProps} {...{ date, rule, interval }} />
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
  days: number = 90,
) {
  const result = await cachedScrapeResult(c.env);
  const page = WeekPage({ date, result, days });
  if (!page) {
    return c.notFound();
  }
  return c.html(page, 200);
}

export default async function view(
  c: Context<{ Bindings: Bindings }>,
  date: string,
) {
  const result = await cachedScrapeResult(c.env);
  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals) {
    return c.notFound();
  }
  return c.html(DayPage({ date, ruleIntervals }), 200);
}
