import { describe, it, expect } from "vitest";
import type { Year } from "./cron";
import type { CalendarDate } from "./scrapeCalendar";
import {
  CALENDAR_FETCH_STRATEGIES,
  describeAttempts,
  fetchCalendarWithFallback,
} from "./fetchCalendar";

const URL = "https://www.sfrecpark.org/calendar.aspx";

const YEARS = [
  { type: "year", year: 2026, rules: [] },
] as unknown as Year<CalendarDate>[];

/** A 522 as Cloudflare actually serves it: an HTML error page, not an exception. */
function gatewayTimeout() {
  return new Response(
    "<html><body>Error 522 Connection timed out</body></html>",
    {
      status: 522,
      headers: { server: "cloudflare", "cf-ray": "abc123-EWR" },
    },
  );
}

function ok() {
  return new Response("<html>calendar</html>", {
    status: 200,
    headers: { server: "cloudflare", "cf-ray": "def456-SJC" },
  });
}

/** Stands in for the HTMLRewriter pass, which is not available outside workerd. */
function scrapeResponse(res: Response) {
  return res.text().then((text) => ({ years: res.ok ? YEARS : [], text }));
}

function fetcher(responses: (() => Response)[]) {
  const seen: string[] = [];
  const fetchImpl = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    seen.push(new Headers(init?.headers).get("user-agent") ?? "(none)");
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("fetchCalendarWithFallback", () => {
  it("uses the honest user-agent and stops there when it works", async () => {
    const { fetchImpl, seen } = fetcher([ok]);
    const result = await fetchCalendarWithFallback(URL, {
      fetchImpl,
      scrapeResponse,
    });
    expect(result.ok && result.strategy).toBe("current");
    expect(seen).toEqual(["polofield.bike"]);
    expect(result.attempts).toHaveLength(1);
  });

  it("falls back to a browser-shaped request when the first attempt 522s", async () => {
    const { fetchImpl, seen } = fetcher([gatewayTimeout, ok]);
    const result = await fetchCalendarWithFallback(URL, {
      fetchImpl,
      scrapeResponse,
    });
    expect(result.ok && result.strategy).toBe("browser-ua");
    expect(seen[1]).toContain("Mozilla/5.0");
    // The failure is still recorded even though the run succeeded.
    expect(result.attempts[0]).toMatchObject({
      strategy: "current",
      status: 522,
      cfRay: "abc123-EWR",
    });
  });

  it("keeps trying when a request throws rather than responding", async () => {
    const { fetchImpl } = fetcher([
      () => {
        throw new Error("Network connection lost.");
      },
      ok,
    ]);
    const result = await fetchCalendarWithFallback(URL, {
      fetchImpl,
      scrapeResponse,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts[0].error).toBe("Network connection lost.");
  });

  it("treats a 200 that yields no calendar as a failure and moves on", async () => {
    // An interstitial or a truncated page: the status says nothing is wrong,
    // but scraper.years is empty, which is the shape of the outage that made
    // the bots go quiet.
    const empty = () =>
      new Response("<html>Just a moment...</html>", { status: 200 });
    const { fetchImpl } = fetcher([empty, ok]);
    const result = await fetchCalendarWithFallback(URL, {
      fetchImpl,
      scrapeResponse: async (res) => ({
        years: (await res.clone().text()).includes("calendar") ? YEARS : [],
        text: await res.text(),
      }),
    });
    expect(result.ok && result.strategy).toBe("browser-ua");
    expect(result.attempts[0]).toMatchObject({ status: 200, years: 0 });
  });

  it("reports every attempt when they all fail", async () => {
    const { fetchImpl } = fetcher(
      CALENDAR_FETCH_STRATEGIES.map(() => gatewayTimeout),
    );
    const result = await fetchCalendarWithFallback(URL, {
      fetchImpl,
      scrapeResponse,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts.map((a) => a.strategy)).toEqual(
      CALENDAR_FETCH_STRATEGIES.map((s) => s.name),
    );
    const summary = describeAttempts(result.attempts);
    expect(summary.split("\n")).toHaveLength(
      // One line per attempt plus the snippet line each carries.
      CALENDAR_FETCH_STRATEGIES.length * 2,
    );
    // The colo is what the report exists for.
    expect(summary).toContain("cf-ray=abc123-EWR");
  });
});
