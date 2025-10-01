import { NonRetryableError } from "cloudflare:workflows";
import { bootstrapWebhooks, runWebhookRow, ScrapeResultsRow } from "../cron";
import { getTodayPacific } from "../dates";
import { discordReport } from "../discord";
import {
  CalendarScraper,
  currentCalendarUrl,
  getScrapeDebugResult,
  stripDebugResult,
} from "../scrapeCalendar";
import { fetchFieldRainoutInfo } from "../scrapeFieldRainoutInfo";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

type Env = Cloudflare.Env;
type Params = Record<never, never>;

export class ScrapePoloWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const today = await step.do("today", async () => {
      // Shift to reporting the next day at 4pm instead of midnight
      const now = new Date();
      now.setHours(now.getHours() - 16);
      return getTodayPacific(now);
    });
    const years = await step
      .do("CalendarScraper", async () => {
        const scraper = new CalendarScraper();
        const fetchRes = await fetch(currentCalendarUrl(), {
          headers: {
            "user-agent": "polofield.bike",
          },
          cache: "no-store",
        });
        const res = new HTMLRewriter().on("*", scraper).transform(fetchRes);
        const txt = await res.text();
        if (scraper.years.length === 0) {
          throw new Error(
            `scraper.years.length === 0\n${fetchRes.url}\n${fetchRes.status} ${fetchRes.statusText}\n\n${txt}`,
          );
        }
        return scraper.years;
      })
      .catch(async (err) => {
        if (err instanceof NonRetryableError) {
          await step.do("CalendarScraper:report", async () => {
            const message = `Error detected when scraping, skipping ${new Date().toISOString()}`;
            await discordReport(this.env, message);
          });
        }
        throw err;
      });
    const oldestYear =
      Math.min(...years.map((y) => y.year)) || new Date().getFullYear();
    const fieldRainoutInfo = await step.do(
      `fetchFieldRainoutInfo(${oldestYear})`,
      async () => fetchFieldRainoutInfo(oldestYear),
    );
    const result = await step.do("result", async () =>
      stripDebugResult(getScrapeDebugResult({ years, fieldRainoutInfo })),
    );
    const logMessages = await step.do("insert", async () => {
      const prev = await this.env.DB.prepare(
        `SELECT created_at, scrape_results_json FROM scrape_results ORDER BY created_at DESC LIMIT 1`,
      ).all<ScrapeResultsRow>();
      const created_at = new Date().toISOString();
      const scrape_results_json = JSON.stringify(result);
      if (
        prev.results.length > 0 &&
        prev.results[0].scrape_results_json === scrape_results_json
      ) {
        return [
          {
            quiet: true,
            message: `No change since ${prev.results[0].created_at}, skipping ${created_at}`,
          },
        ];
      } else if (result.length === 0 && prev.results.length > 0) {
        return [
          {
            quiet: false,
            message: `Error detected when scraping, skipping ${created_at}`,
          },
        ];
      } else {
        await this.env.DB.prepare(
          `INSERT INTO scrape_results (created_at, scrape_results_json) VALUES (?, ?)`,
        )
          .bind(created_at, scrape_results_json)
          .run();
        return [
          {
            quiet: false,
            message: `Error detected when scraping, skipping ${created_at}`,
          },
        ];
      }
    });

    for (const { quiet, message } of logMessages) {
      console.log(message);
      if (!quiet) {
        await step.do(`discordReport ${message}`, async () =>
          discordReport(this.env, message),
        );
      }
    }

    await step.do("bootstrapWebhooks", async () => bootstrapWebhooks(this.env));

    const webhooks = await step.do("webhooks", async () => {
      const res = await this.env.DB.prepare(
        `SELECT webhook_url, params_json, last_update_utc FROM daily_webhook_status WHERE last_update_utc < ?`,
      )
        .bind(today)
        .all<
          Record<"webhook_url" | "last_update_utc" | "params_json", string>
        >();
      return res.results;
    });

    await Promise.all(
      webhooks.map(async (row, i) =>
        step.do(`runWebhookRow ${i}`, async () =>
          runWebhookRow(this.env, today, result, row),
        ),
      ),
    );

    return logMessages.map((msg) => msg.message);
  }
}
