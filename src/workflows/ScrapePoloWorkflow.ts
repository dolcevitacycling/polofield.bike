import { ScrapeResult, ScrapeResultsRow } from "../cron";
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

export async function scrapePoloURL(): Promise<ScrapeResult> {
  const scraper = new CalendarScraper();
  const res = new HTMLRewriter()
    .on("*", scraper)
    .transform(await fetch(currentCalendarUrl()));
  await res.text();
  const oldestYear =
    Math.min(...scraper.years.map((y) => y.year)) || new Date().getFullYear();
  scraper.fieldRainoutInfo = await fetchFieldRainoutInfo(oldestYear);
  return scraper.getResult();
}

type Env = Cloudflare.Env;
type Params = { log?: boolean };

export class ScrapePoloWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { log = false } = event.payload;
    const years = await step.do("CalendarScraper", async () => {
      const scraper = new CalendarScraper();
      const res = new HTMLRewriter()
        .on("*", scraper)
        .transform(await fetch(currentCalendarUrl()));
      await res.text();
      return scraper.years;
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
        console.log(
          `No change since ${prev.results[0].created_at}, skipping ${created_at}`,
        );
        return [];
      } else if (result.length === 0 && prev.results.length > 0) {
        const logMessage = `Error detected when scraping, skipping ${created_at}`;
        console.log(logMessage);
        return [logMessage];
      } else {
        await this.env.DB.prepare(
          `INSERT INTO scrape_results (created_at, scrape_results_json) VALUES (?, ?)`,
        )
          .bind(created_at, scrape_results_json)
          .run();
        const logMessage = `Error detected when scraping, skipping ${created_at}`;
        console.log(logMessage);
        return [logMessage];
      }
    });
    for (const logMessage of logMessages) {
      if (log) {
        await step.do(`discordReport ${logMessage}`, async () =>
          discordReport(this.env, logMessage),
        );
      }
    }
  }
}
