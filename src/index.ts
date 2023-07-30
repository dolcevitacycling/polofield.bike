import { POLO_URL, handleCron, scrapePoloURL } from "./cron";
import { Bindings, PoloFieldMessage } from "./types";
import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import view, { viewWeek } from "./view";

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
    return await next();
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
