import { ScheduleScraper, handleCron } from "./cron";
import { Env, PoloFieldMessage } from "./types";

// UX idea https://newatlas.com/better-parking-signs-nikki-sylianteng/32970/

const POLO_URL = "https://www.sfrecpark.org/526/Polo-Field-Usage";

const mod: ExportedHandler<Env, PoloFieldMessage> = {
  async queue(batch, env) {
    // if (batch.queue === "slack-files") {
    //   await processSlackFilesBatch(batch, env);
    // }
  },
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(handleCron(event, env));
  },
  async fetch(request: Request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico" || url.pathname === "/robots.txt") {
      return new Response("", { status: 404 });
    }
    // if (url.pathname.startsWith("/slack/")) {
    //   return slackFetchHandler(url, request, env, ctx);
    // } else if (url.pathname.startsWith("/benefits/")) {
    //   return benefitsFetchHandler(url, request, env, ctx);
    // }
    if (url.pathname === "/") {
      return new Response("Bike is life", {
        status: 302,
        headers: { Location: POLO_URL },
      });
    } else if (url.pathname === "/scrape") {
      const scraper = new ScheduleScraper();
      const res = new HTMLRewriter()
        .on("*", scraper)
        .transform(await fetch(POLO_URL));
      await res.text();
      return new Response(JSON.stringify(scraper.getResult(), null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } else if (url.pathname === "/view") {
      const scraper = new ScheduleScraper();
      const res = new HTMLRewriter()
        .on("*", scraper)
        .transform(await fetch(POLO_URL));
      await res.text();
      const now = new Date();
      const today = Intl.DateTimeFormat("fr-CA", {
        timeZone: "America/Los_Angeles",
      }).format(now);
      for (const sched of scraper.getResult()) {
        if (sched.year !== now.getFullYear()) {
          continue;
        }
        const past = [];
        const current = [];
        const future = [];
        const todayIntervals = [];
        for (const rule of sched.rules) {
          if (rule.end_date < today) {
            past.push(rule);
          } else if (rule.start_date <= today) {
            current.push(rule);
            if (rule.type === "known_rules") {
              for (const interval of rule.intervals) {
                if (
                  interval.start_timestamp.split(" ")[0] <= today &&
                  interval.end_timestamp.split(" ")[0] >= today
                ) {
                  todayIntervals.push(interval);
                }
              }
            }
          } else {
            future.push(rule);
          }
        }
        return new Response(
          JSON.stringify(
            { today, todayIntervals, current, future, past },
            null,
            2,
          ),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response("", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  },
};

export default mod;
