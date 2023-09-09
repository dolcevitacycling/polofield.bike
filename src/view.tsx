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
import {
  randomCyclist,
  NO_BIKES,
  randomShrug,
  WARNING,
  SUNRISE,
  SUNSET,
} from "./emoji";
import { SunProps, getSunProps } from "./sun";

interface Props {
  date: string;
  children?: unknown;
  titlePrefix?: string;
  created_at: string;
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
        .open.now .copy {
          text-shadow:
            /* White glow */
            0 0 7px #fff,
            0 0 10px #fff,
            0 0 21px #fff,
            /* Green glow */ 0 0 42px #0fa,
            0 0 82px #0fa;
        }
        .now .background:after {
          display: block;
          position: absolute;
          top: 0;
          bottom: 0;
          width: 10px;
          transform: translate(-50%, 0);
          left: var(--now-percent, 0);
          content: " ";
        }
        .open.now .background:after {
          background: linear-gradient(
            to right,
            #ffffff00,
            #ffffffff,
            #ffffff00
          );
        }
        .closed.now .background:after {
          background: linear-gradient(
            to right,
            #00000000,
            #000000ff,
            #00000000
          );
        }
        .closed.now .copy {
          text-shadow:
            /* Black glow */
            0 0 7px #000,
            0 0 10px #000,
            0 0 21px #000,
            /* Red glow */ 0 0 42px #f03,
            0 0 82px #f03;
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
      <body
        data-created="${props.created_at}"
        data-render="${new Date().toISOString()}"
      >
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
          |
          <a
            href="tel:415-831-2700"
            class="no-underline"
            title="Contact SF Rec &amp; Parks"
            ><span class="base">☎️</span></a
          >
        </nav>
        ${props.children}
        <script type="module" src="/js/tooltip.mjs"></script>
        <script type="module" src="/js/now.mjs"></script>
      </body>
    </html>`;
}

function DayPage(props: {
  date: string;
  created_at: string;
  ruleIntervals: ReturnType<typeof intervalsForDate>;
}) {
  return (
    <Layout
      date={props.date}
      created_at={props.created_at}
      titlePrefix={titlePrefix(props.ruleIntervals)}
    >
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

function WeekPage(props: {
  date: string;
  created_at: string;
  result: ScrapeResult;
  days: number;
}) {
  const { date, created_at, result, days } = props;
  const d = parseDate(date);

  const ruleIntervals = intervalsForDate(result, date);

  return (
    <Layout
      date={date}
      titlePrefix={titlePrefix(ruleIntervals)}
      created_at={created_at}
    >
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
    result.push(`${SUNRISE} ${friendlyTime(sunrise)}`);
  }
  if (hEnd >= sunsetStart) {
    result.push(`${SUNSET} ${friendlyTime(sunsetStart)}`);
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
      <div
        class="background"
        style={
          open ? `background: ${sunGradient(tStart, tEnd, props)};` : undefined
        }
      ></div>
      <button aria-label={title}>
        <span class="copy">{open ? randomCyclist() : NO_BIKES}</span>
      </button>
    </li>
  );
}

function Intervals(props: {
  date: string;
  rule: KnownRules;
  intervals: RuleInterval[];
}) {
  const { date, rule, intervals } = props;
  return (
    <ul class="intervals" data-date={date}>
      {intervals.map((interval) => (
        <Interval
          {...getSunProps(parseDate(date))}
          {...{ date, rule, interval }}
        />
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
  const { created_at, scrape_results: result } = await cachedScrapeResult(
    c.env,
  );
  if (c.req.headers.get("accept") === "application/json") {
    return c.json({ date, created_at, result }, 200);
  }
  const page = WeekPage({ created_at, date, result, days });
  if (!page) {
    return c.notFound();
  }
  return c.html(page, 200);
}

export default async function view(
  c: Context<{ Bindings: Bindings }>,
  date: string,
) {
  const { created_at, scrape_results: result } = await cachedScrapeResult(
    c.env,
  );

  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals) {
    return c.notFound();
  }
  if (c.req.headers.get("accept") === "application/json") {
    return c.json({ date, created_at, ruleIntervals }, 200);
  }
  return c.html(DayPage({ date, created_at, ruleIntervals }), 200);
}
