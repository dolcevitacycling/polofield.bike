import { POLO_URL, handleCron, scrapePoloURL } from "./cron";
import { Bindings, PoloFieldMessage } from "./types";
import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import view, { viewWeek } from "./view";
import icalFeed, { calendarView } from "./icalFeed";

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
    Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
  ),
);
app.get("/calendar", calendarView({ open: false }));
app.get("/calendar.ics", icalFeed({ open: false }));
app.get("/calendar/open", calendarView({ open: true }));
app.get("/calendar/open.ics", icalFeed({ open: true }));
app.get("/calendar/all", calendarView({}));
app.get("/calendar/all.ics", icalFeed({}));
app.get("/today", async (c) =>
  viewWeek(
    c,
    Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
  ),
);
app.get("/scrape", async (c) => {
  const result = await scrapePoloURL();
  return c.text(JSON.stringify(result), 200, {
    "Content-Type": "application/json",
  });
});
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
