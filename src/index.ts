import { cachedScrapeResult, handleCron } from "./cron";
import { Bindings, PoloFieldMessage } from "./types";
import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import view, { viewWeek } from "./view";
import icalFeed, { calendarView } from "./icalFeed";
import { pacificISODate, parseDate } from "./dates";

// Add calendar feeds?
// Title hover
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
    pacificISODate.format(
      ((n) => (n && /^\d{4}-\d{2}-\d{2}$/.test(n) ? parseDate(n) : new Date()))(
        c.req.query("date"),
      ),
    ),
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
app.get("/scrape", async (c) => c.text(JSON.stringify(await cachedScrapeResult(c.env)), 200, {
  "Content-Type": "application/json",
}));
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
