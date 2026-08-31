import { Context } from "hono";
import type { Bindings } from "./types";
import { isAuthorized } from "./adminPatches";
import { currentCalendarUrl } from "./scrapeCalendar";

/**
 * Fetch the calendar from inside the Worker, several ways, and report what
 * happened.
 *
 * The scrape has been getting 522s from sfrecpark.org for days while the exact
 * same URL returns 200 in about a second from a laptop, so the difference is
 * something about the request the Worker makes rather than the origin being
 * down or the query being too expensive. That is not reproducible anywhere but
 * production, hence this: run the variants, see which ones come back 200, and
 * change the scraper to match.
 *
 * Read-only and pinned to the calendar host, so it cannot be used to make the
 * Worker fetch arbitrary URLs, and unlike /force-cron it has no side effects —
 * no writes, and no chance of posting a stale schedule to Slack or Discord.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface Variant {
  readonly name: string;
  readonly init: RequestInit;
}

const VARIANTS: readonly Variant[] = [
  // What the scraper sends today.
  {
    name: "current",
    init: { headers: { "user-agent": "polofield.bike" }, cache: "no-store" },
  },
  // Is it the bare user-agent? sfrecpark is behind Cloudflare, and bot rules
  // can treat a non-browser agent very differently.
  {
    name: "browser-ua",
    init: {
      headers: {
        "user-agent": BROWSER_UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    },
  },
  // Is it cache: "no-store"? That turns into a no-cache request upstream.
  {
    name: "browser-ua-cached",
    init: {
      headers: {
        "user-agent": BROWSER_UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    },
  },
  // Nothing set at all, so the runtime's own defaults apply.
  { name: "defaults", init: {} },
];

export async function probeUpstream(c: Context<{ Bindings: Bindings }>) {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const url = currentCalendarUrl();
  const results = [];
  for (const variant of VARIANTS) {
    const started = Date.now();
    try {
      const res = await fetch(url, variant.init);
      const body = await res.text();
      results.push({
        variant: variant.name,
        status: res.status,
        ms: Date.now() - started,
        bytes: body.length,
        // A 522 is a Cloudflare error page, so the first bytes say which
        // hop gave up; a good response starts with the calendar markup.
        snippet: body.slice(0, 160).replace(/\s+/g, " "),
        server: res.headers.get("server"),
        cf_ray: res.headers.get("cf-ray"),
        cf_cache_status: res.headers.get("cf-cache-status"),
      });
    } catch (err) {
      results.push({
        variant: variant.name,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return c.json({ url, results });
}
