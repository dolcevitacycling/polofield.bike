import {
  cachedScrapeResult,
  handleCron,
  recentScrapedResults,
  refreshScrapeResult,
} from "./cron";
import { Bindings, PoloFieldMessage } from "./types";
import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import view, { viewWeek } from "./view";
import icalFeed, { calendarView } from "./icalFeed";
import { pacificISODate, parseDate, shortDateStyle } from "./dates";

// API
// Add weather? https://developer.apple.com/weatherkit/get-started/

const app = new Hono<{ Bindings: Bindings }>();

app.use(async (c, next) => {
  const url = new URL(c.req.url);
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    url.protocol = "https:";
    return c.redirect(url.toString(), 302);
  } else {
    await next();
    if (url.protocol === "https:") {
      c.res.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
  }
});
app.get("/", async (c) =>
  viewWeek(
    c,
    ((n) =>
      n && /^\d{4}-\d{2}-\d{2}$/.test(n)
        ? shortDateStyle.format(parseDate(n))
        : pacificISODate.format(new Date()))(c.req.query("date")),
    ((n) => (n && /^\d+$/.test(n) ? parseInt(n, 10) : undefined))(
      c.req.query("days"),
    ),
  ),
);
app.get("/calendar", calendarView({ open: false }));
app.get("/calendar.ics", icalFeed({ open: false }));
app.get("/calendar/closed", calendarView({ open: false }));
app.get("/calendar/closed.ics", icalFeed({ open: false }));
app.get("/calendar/open", calendarView({ open: true }));
app.get("/calendar/open.ics", icalFeed({ open: true }));
app.get("/calendar/all", calendarView({}));
app.get("/calendar/all.ics", icalFeed({}));
app.get("/today", async (c) => viewWeek(c, pacificISODate.format(new Date())));
app.get("/status.json", async (c) => {
  const cache = await cachedScrapeResult(c.env);
  const now = new Date();
  const status = {
    now: now.toISOString(),
    created_at: cache.created_at,
    cache_age_seconds: Math.round(
      (now.getTime() - new Date(cache.created_at).getTime()) / 1000,
    ),
    has_unknown_rules: cache.scrape_results.some((y) =>
      y.rules.some((x) => x.type === "unknown_rules"),
    ),
    years: cache.scrape_results.map((y) => y.year),
  };
  return c.text(JSON.stringify(status, null, 2), 200, {
    "Content-Type": "application/json",
  });
});
app.get("/scrape", async (c) =>
  c.text(JSON.stringify(await cachedScrapeResult(c.env)), 200, {
    "Content-Type": "application/json",
  }),
);
app.get("/dump.json", async (c) =>
  c.text(JSON.stringify(await recentScrapedResults(c.env)), 200, {
    "Content-Type": "application/json",
  }),
);
app.get("/force-cron", async (c) =>
  c.json(await refreshScrapeResult(c.env, { log: true })),
);
app.get("/:date{[0-9]{4}-[0-9]{2}-[0-9]{2}}", async (c) =>
  view(c, c.req.param().date),
);
app.get("/*", serveStatic({ root: "./" }));

const mod: ExportedHandler<Bindings, PoloFieldMessage> = {
  async queue(batch, env) {
    // if (batch.queue === "slack-files") {
    //   await processSlackFilesBatch(batch, env);
    // }
  },
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(handleCron(event, env));
  },
  async fetch(request: Request, env, ctx): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

export default mod;
