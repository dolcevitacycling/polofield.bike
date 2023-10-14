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
  open?: boolean;
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
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        }
        :root {
          --open-color: #2dc937;
          --closed-color: #cc3232;
          --nav-internal-height: 60px;
          --nav-height: calc(var(--nav-internal-height) + 2px);
        }
        body {
          margin: 0;
          padding: 0;
        }
        header {
          position: fixed;
          background-color: #fff;
          width: 100%;
          z-index: 1;
        }
        :global([id]) {
          scroll-margin-top: var(--nav-height);
        }
        main {
          position: relative;
          z-index: 0;
          margin: 24px;
          padding-top: var(--nav-height);
        }
        ul.intervals {
          list-style-type: none;
          padding-left: 0;
          display: flex;
        }
        h1 {
          text-align: center;
        }
        .intervals > li {
          margin-top: 1em;
          position: relative;
          font-weight: bold;
          font-size: 2em;
          height: 4em;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .intervals > li > button {
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
          top: -0.1em;
          left: 0;
          transform: translate(0, -100%);
        }
        .today > li:first-of-type .time {
          font-weight: bolder;
        }
        .open {
          background-color: var(--open-color);
        }
        .now .copy {
          transition: text-shadow 0.25s ease-in-out;
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
          transition: left 0.5s ease-in-out;
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
          background: repeating-linear-gradient(
            135deg,
            var(--closed-color),
            var(--closed-color) 10px,
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
          top: 0;
          bottom: 0;
          left: 0;
          right: 0;
        }
        .closed .background:before {
          border: 10px solid var(--closed-color);
          content: " ";
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
        }
        .no-underline {
          text-decoration: none;
        }
        .tooltip {
          position: absolute;
          top: 0;
          left: 0;
          width: max-content;
          max-width: 90%;
          background: #222;
          color: white;
          font-weight: bold;
          padding: 5px;
          border-radius: 4px;
          font-size: 90%;
          z-index: 2;
          pointer-events: none;
        }
        .tooltip-arrow {
          position: absolute;
          background: #222;
          width: 8px;
          height: 8px;
          transform: rotate(45deg);
        }
        .container {
          max-width: 1050px;
          width: 90%;
          margin: auto;
        }

        .navbar {
          width: 100%;
          box-shadow: 0 1px 4px rgb(146 161 176 / 15%);
        }

        .nav-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: var(--nav-height);
        }

        .navbar .nav-container li {
          list-style: none;
        }

        .nav-container {
          display: flex;
          height: var(--nav-internal-height);
        }

        .nav-container input[type="checkbox"] {
          display: none;
        }

        .nav-container .hamburger-lines {
          display: block;
          cursor: pointer;
          height: 42px;
          width: 48px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .nav-container .hamburger-lines .line {
          display: block;
          height: 4px;
          width: 100%;
          border-radius: 10px;
          background: #0e2431;
        }

        .nav-container .hamburger-lines .line1 {
          transform-origin: 0% 0%;
          transition: transform 0.4s ease-in-out;
        }

        .nav-container .hamburger-lines .line2 {
          transition: transform 0.2s ease-in-out;
        }

        .nav-container .hamburger-lines .line3 {
          transform-origin: 0% 100%;
          transition: transform 0.4s ease-in-out;
        }

        .navbar .menu-items {
          position: absolute;
          left: 0px;
          top: var(--nav-internal-height);
          height: calc(100vh - var(--nav-internal-height));
          width: 100vw;
          transform: translate(-150%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: transform 0.5s ease-in-out;
          background-color: var(--open-color);
        }

        .navbar .menu-items ul {
          display: flex;
          flex-direction: column;
          margin: 0 auto;
          padding: 1rem 0;
        }

        .navbar .menu-items li {
          margin-bottom: 1.2rem;
          font-size: 1.5rem;
          font-weight: 500;
        }
        .menu-items li > a {
          display: flex;
          align-items: center;
          color: #000;
          gap: 0.5rem;
        }
        .menu-items a .base {
          position: relative;
          font-size: 2rem;
        }
        .menu-items a .overlap {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: scale(0.5) translate(-100%, -75%);
        }
        .nav-container input[type="checkbox"]:checked ~ .menu-items {
          transform: translateX(0);
        }

        .nav-container
          input[type="checkbox"]:checked
          ~ .hamburger-lines
          .line1 {
          transform: rotate(45deg);
        }

        .nav-container
          input[type="checkbox"]:checked
          ~ .hamburger-lines
          .line2 {
          transform: scaleY(0);
        }
        .nav-container
          input[type="checkbox"]:checked
          ~ .hamburger-lines
          .line3 {
          transform: rotate(-45deg);
        }

        .logo a {
          color: #000;
        }
        .status.open-now:after {
          content: "${randomCyclist()}";
        }
        .status.closed-now:after {
          content: "${NO_BIKES}";
        }

        .sponsor {
          background-color: #000;
          color: #fff;
          padding: 1rem;
          padding-bottom: calc(1rem + 100vh - 100dvh);
        }
        .sponsor .container {
          text-align: center;
        }
        .sponsor h2 {
          margin: 0 0 0.5rem;
        }
        .sponsor img {
          max-width: 250px;
          padding: 8px;
        }

        @media only screen and (max-width: 480px) {
          main {
            margin: 12px;
            font-size: 10px;
          }
          .time {
            font-size: 12px;
          }
        }
      </style>
      <body
        data-created="${props.created_at}"
        data-render="${new Date().toISOString()}"
      >
        <header>
          <nav role="navigation">
            <div class="navbar">
              <div class="container nav-container">
                <input type="checkbox" id="nav-toggle" />
                <label class="hamburger-lines" for="nav-toggle">
                  <span class="line line1"></span>
                  <span class="line line2"></span>
                  <span class="line line3"></span>
                </label>
                <div class="logo">
                  <h1>
                    <span class="status base"></span>
                    <a href="https://polofield.bike" class="no-underline"
                      >polofield.bike</a
                    >
                  </h1>
                </div>
                <div class="menu-items">
                  <ul class="container">
                    <li>
                      <a href="${POLO_URL}" class="no-underline"
                        ><span class="base">🏞️</span>Ethan Boyes Cycle Track @
                        GGP Polo Field Schedule</a
                      >
                    </li>
                    <li>
                      <a
                        href="/calendar/open"
                        class="no-underline"
                        title="Google Calendar of Cycle Track openings"
                        ><span class="base"
                          >🗓️<span class="overlap"
                            >${randomCyclist()}</span
                          ></span
                        >
                        Cycle Track openings</a
                      >
                    </li>
                    <li>
                      <a
                        href="/calendar/closed"
                        class="no-underline"
                        title="Google Calendar of Cycle Track closures"
                        ><span class="base"
                          >🗓️<span class="overlap">${NO_BIKES}</span></span
                        >
                        Cycle Track closures</a
                      >
                    </li>
                    <li>
                      <a
                        href="tel:415-831-2700"
                        class="no-underline"
                        title="Contact SF Rec &amp; Parks"
                        ><span class="base">☎️</span> Contact SF Rec &amp;
                        Parks</a
                      >
                    </li>
                    <li>
                      <a
                        href="https://discord.gg/FYqedSVJ78"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="no-underline"
                        ><span class="base"
                          ><img
                            src="/img/discord-mark-blue.svg"
                            style="width: 1em; height: 1em; position: relative; top: 0.15em; filter: drop-shadow(1px 1px 0px rgb(255 255 255 / 0.4));"
                            alt="Discord logo"
                        /></span>
                        polofield.bike Discord</a
                      >
                    </li>
                  </ul>
                  <div class="sponsor">
                    <div class="container">
                      <h2>Powered By</h2>
                      <a
                        href="https://www.dolcevitacycling.org/"
                        target="_blank"
                        title="Powered by Dolce Vita Cycling"
                        ><img
                          src="/img/dvc-logo-horizontal.svg"
                          alt="Dolce Vita Cycling logo"
                      /></a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </nav>
        </header>
        <main class="container">${props.children}</main>
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
        <ul class="rules">
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
  if (c.req.header("accept") === "application/json") {
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
  if (c.req.header("accept") === "application/json") {
    return c.json({ date, created_at, ruleIntervals }, 200);
  }
  return c.html(DayPage({ date, created_at, ruleIntervals }), 200);
}
