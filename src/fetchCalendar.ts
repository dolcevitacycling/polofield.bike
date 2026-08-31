import type { Year } from "./cron";
import {
  CalendarScraper,
  currentCalendarUrl,
  type CalendarDate,
} from "./scrapeCalendar";

/**
 * Fetch the calendar, trying a few request shapes before giving up.
 *
 * Since 2026-08-28 the scrape has been getting 522s from sfrecpark.org on
 * every cron run while the identical URL returns 200 from a laptop, and — the
 * part that makes a single request shape untenable — from this same Worker's
 * fetch handler (/admin/probe-upstream returned 200 on all four variants while
 * the workflow was on consecutive failure #67). Whatever the origin's edge is
 * keying on, it is not stable per request, so one attempt is not evidence that
 * upstream is down.
 *
 * Every attempt is recorded, headers included, so a failure report says which
 * shapes were tried and which Cloudflare colo served each one (cf-ray's suffix
 * is the colo). That is the missing piece for the current outage: the workflow
 * logs said nothing about where its requests were going.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "user-agent": BROWSER_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export interface CalendarFetchStrategy {
  readonly name: string;
  readonly init: RequestInit;
}

/**
 * Ordered by preference, not by likelihood of working: the honest user-agent
 * goes first so a healthy origin keeps seeing the same request it always has,
 * and the browser-shaped ones are only reached when that fails.
 */
export const CALENDAR_FETCH_STRATEGIES: readonly CalendarFetchStrategy[] = [
  {
    name: "current",
    init: { headers: { "user-agent": "polofield.bike" }, cache: "no-store" },
  },
  // sfrecpark.org is itself behind Cloudflare, and bot rules can treat a
  // non-browser agent very differently.
  { name: "browser-ua", init: { headers: BROWSER_HEADERS, cache: "no-store" } },
  // cache: "no-store" becomes a no-cache request upstream, so a cached edge
  // response cannot be used to answer it — worth a try when the origin behind
  // that edge is the thing timing out.
  { name: "browser-ua-cached", init: { headers: BROWSER_HEADERS } },
  // Nothing set at all, so the runtime's own defaults apply.
  { name: "defaults", init: {} },
];

/** The shape we would use if the origin were behaving; anything else is a fallback. */
export const PRIMARY_STRATEGY = CALENDAR_FETCH_STRATEGIES[0].name;

/**
 * Give up on an attempt after this long.
 *
 * The origin is bimodal: a good response is back in about a second (1022ms for
 * 76444 bytes), and a bad one spends 19.5s before Cloudflare gives up with a
 * 522. Waiting out that full timeout on each of three attempts is 40s of dead
 * time per run for no information — the answer is already known by 10s.
 */
export const ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * Try `preferred` first, then everything else in the declared order.
 *
 * The winning shape is worth remembering because retrying is what actually
 * gets us a response: the same query came back in 1022ms on the third attempt
 * of a run whose first two spent 19.5s each reaching a 522. Leading with the
 * shape that worked last time turns the common case back into one fast
 * request, instead of paying the timeout twice before getting there.
 */
export function orderStrategies(
  preferred: string | null | undefined,
  strategies: readonly CalendarFetchStrategy[] = CALENDAR_FETCH_STRATEGIES,
): readonly CalendarFetchStrategy[] {
  const first = strategies.find((s) => s.name === preferred);
  return first === undefined
    ? strategies
    : [first, ...strategies.filter((s) => s !== first)];
}

export interface CalendarFetchAttempt {
  readonly strategy: string;
  readonly ms: number;
  readonly status?: number;
  readonly bytes?: number;
  readonly years?: number;
  readonly server?: string | null;
  readonly cfRay?: string | null;
  readonly cfCacheStatus?: string | null;
  readonly error?: string;
  readonly snippet?: string;
}

export type CalendarFetchResult =
  | {
      readonly ok: true;
      readonly strategy: string;
      readonly years: Year<CalendarDate>[];
      readonly attempts: readonly CalendarFetchAttempt[];
    }
  | { readonly ok: false; readonly attempts: readonly CalendarFetchAttempt[] };

export interface CalendarFetchDeps {
  readonly strategies?: readonly CalendarFetchStrategy[];
  /** Name of the shape that worked last time; tried first. */
  readonly preferStrategy?: string | null;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Runs the response through the scraper. Injectable so tests can skip HTMLRewriter. */
  readonly scrapeResponse?: (
    res: Response,
  ) => Promise<{ years: Year<CalendarDate>[]; text: string }>;
}

async function scrapeResponseWithRewriter(
  res: Response,
): Promise<{ years: Year<CalendarDate>[]; text: string }> {
  const scraper = new CalendarScraper();
  const text = await new HTMLRewriter().on("*", scraper).transform(res).text();
  return { years: scraper.years, text };
}

/** One line per attempt, for a Discord/Sentry failure report. */
export function describeAttempts(
  attempts: readonly CalendarFetchAttempt[],
): string {
  return attempts
    .map((a) => {
      const parts = [`${a.strategy}: ${a.ms}ms`];
      if (a.error !== undefined) {
        parts.push(`threw ${a.error}`);
      } else {
        parts.push(`HTTP ${a.status}`, `${a.years} years`, `${a.bytes} bytes`);
      }
      if (a.server) parts.push(`server=${a.server}`);
      if (a.cfRay) parts.push(`cf-ray=${a.cfRay}`);
      if (a.cfCacheStatus) parts.push(`cf-cache=${a.cfCacheStatus}`);
      const line = parts.join(" ");
      return a.snippet ? `${line}\n  ${a.snippet}` : line;
    })
    .join("\n");
}

export async function fetchCalendarWithFallback(
  url: string = currentCalendarUrl(),
  deps: CalendarFetchDeps = {},
): Promise<CalendarFetchResult> {
  const fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
  const scrapeResponse = deps.scrapeResponse ?? scrapeResponseWithRewriter;
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const attempts: CalendarFetchAttempt[] = [];
  for (const strategy of orderStrategies(
    deps.preferStrategy,
    deps.strategies ?? CALENDAR_FETCH_STRATEGIES,
  )) {
    const started = Date.now();
    try {
      const res = await fetchImpl(url, {
        ...strategy.init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const { years, text } = await scrapeResponse(res);
      const good = res.ok && years.length > 0;
      attempts.push({
        strategy: strategy.name,
        ms: Date.now() - started,
        status: res.status,
        bytes: text.length,
        years: years.length,
        server: res.headers.get("server"),
        cfRay: res.headers.get("cf-ray"),
        cfCacheStatus: res.headers.get("cf-cache-status"),
        // A 522 is a Cloudflare error page, so its first bytes say which hop
        // gave up. Only kept for failures; a good response is the calendar.
        ...(good
          ? {}
          : { snippet: text.slice(0, 300).replace(/\s+/g, " ").trim() }),
      });
      if (good) {
        return { ok: true, strategy: strategy.name, years, attempts };
      }
    } catch (err) {
      attempts.push({
        strategy: strategy.name,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: false, attempts };
}
