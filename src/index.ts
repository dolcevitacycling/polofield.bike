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
import view from "./view";

// UX idea https://newatlas.com/better-parking-signs-nikki-sylianteng/32970/

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => c.redirect(POLO_URL));
app.get("/scrape", async (c) => {
  const result = await scrapePoloURL();
  return c.text(JSON.stringify(result, null, 2), 200, {
    "Content-Type": "application/json",
  });
});
app.get("/today", async (c) =>
  view(
    c,
    Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
  ),
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
