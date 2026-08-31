import { Context } from "hono";
import type { Bindings } from "./types";
import { isAuthorized } from "./adminPatches";
import { currentCalendarUrl } from "./scrapeCalendar";
import {
  CALENDAR_FETCH_STRATEGIES,
  describeAttempts,
  fetchCalendarWithFallback,
} from "./fetchCalendar";

/**
 * Fetch the calendar from inside the Worker, several ways, and report what
 * happened.
 *
 * The scrape has been getting 522s from sfrecpark.org for days while the exact
 * same URL returns 200 in about a second from a laptop. That is not
 * reproducible anywhere but production, hence this: run the variants and see
 * which ones come back 200.
 *
 * It runs the same strategies, in the same order, that the scraper itself now
 * falls back through, so the probe answers a question about the scraper rather
 * than about a separate list that has drifted from it. Unlike /force-cron it
 * has no side effects — no writes, and no chance of posting a stale schedule
 * to Slack or Discord — and it is pinned to the calendar URL, so it cannot be
 * used to make the Worker fetch arbitrary hosts.
 */
export async function probeUpstream(c: Context<{ Bindings: Bindings }>) {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const url = currentCalendarUrl();
  // The scraper stops at the first strategy that works; the probe is meant to
  // report on all of them, so it asks for each one individually.
  const attempts = [];
  for (const strategy of CALENDAR_FETCH_STRATEGIES) {
    const result = await fetchCalendarWithFallback(url, {
      strategies: [strategy],
    });
    attempts.push(...result.attempts);
  }
  return c.json({
    url,
    attempts,
    summary: describeAttempts(attempts),
  });
}
