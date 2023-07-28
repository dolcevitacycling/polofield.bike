import {
  POLO_URL,
  ScheduleScraper,
  handleCron,
  intervalsForDate,
  scrapePoloURL,
} from "./cron";
import { Bindings, PoloFieldMessage } from "./types";
import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";

// UX idea https://newatlas.com/better-parking-signs-nikki-sylianteng/32970/

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => c.redirect(POLO_URL));
app.get("/scrape", async (c) => {
  const result = await scrapePoloURL();
  return c.text(JSON.stringify(result, null, 2), 200, {
    "Content-Type": "application/json",
  });
});
app.get("/today", async (c) => {
  const result = await scrapePoloURL();
  const now = new Date();
  const today = Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
  const ruleIntervals = intervalsForDate(result, today);
  if (!ruleIntervals) {
    return c.notFound();
  }
  return c.text(JSON.stringify(ruleIntervals, null, 2), 200, {
    "Content-Type": "application/json",
  });
});
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
