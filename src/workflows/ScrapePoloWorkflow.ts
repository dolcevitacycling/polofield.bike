import * as Sentry from "@sentry/cloudflare";
import {
  bootstrapWebhooks,
  claimWebhookRow,
  postWebhookRow,
  ScrapeResultsRow,
} from "../cron";
import { applyScrapePatches, loadScrapePatches } from "../patches";
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
    try {
      return await this.runInner(event, step);
    } catch (err) {
      // Without this, a failed instance is only visible in the Cloudflare
      // dashboard — the 2026-08-19 "Cycle Track Until 11:00 AM" parse error
      // went unnoticed for exactly that reason.
      await step.do("report-failure", async () => {
        const detail =
          err instanceof Error ? (err.stack ?? err.message) : String(err);
        await discordReport(
          this.env,
          `ScrapePoloWorkflow failed: ${detail}`.slice(0, 1800),
        );
      });
      throw err;
    }
  }

  async runInner(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const today = await step.do("today", async () => {
      // Shift to reporting the next day at 4pm instead of midnight
      const now = new Date();
      now.setHours(now.getHours() - 16);
      return getTodayPacific(now);
    });
    const years = await step.do("CalendarScraper", async () => {
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
    });
    const oldestYear =
      Math.min(...years.map((y) => y.year)) || new Date().getFullYear();
    const fieldRainoutInfo = await step.do(
      `fetchFieldRainoutInfo(${oldestYear})`,
      async () => fetchFieldRainoutInfo(oldestYear),
    );
    // Days that fail to parse are degraded to unknown_rules rather than
    // aborting the scrape, so the failures have to be carried out of the step
    // deliberately: step results are memoized, and a plain side effect here
    // would not survive a replay.
    const { result, failures } = await step.do("result", async () => {
      const failures: {
        date: string;
        error: string;
        names: string[];
      }[] = [];
      const debugResult = getScrapeDebugResult(
        { years, fieldRainoutInfo },
        ({ date, error, entries }) => {
          failures.push({
            date,
            error: error instanceof Error ? error.message : String(error),
            names: entries.map((e) => e.name),
          });
        },
      );
      return { result: stripDebugResult(debugResult), failures };
    });

    // Report every run (not just when the scrape changes) so Sentry's
    // last-seen stays accurate; Sentry groups these into one issue per
    // distinct parse failure.
    if (failures.length > 0) {
      await step.do("captureUnrecognized", async () => {
        for (const failure of failures) {
          Sentry.captureException(
            new Error(`Unparseable calendar entry: ${failure.error}`),
            {
              tags: { scrape_date: failure.date },
              extra: { names: failure.names },
            },
          );
        }
      });
    }
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
        const messages = [
          {
            quiet: false,
            message: `Inserted new scrape result at ${created_at}`,
          },
        ];
        // Days that failed to parse are degraded to unknown_rules by
        // recognizeCalendarDate; make sure that's noticed, since the bots
        // will say "I don't understand these rules yet" for them. Reported
        // from this branch (rather than every run) because it only runs when
        // the scrape actually changed — otherwise a single broken day would
        // post to #diagnostics every 20 minutes. Sentry has the per-run
        // detail if you need to know it is still broken.
        if (failures.length > 0) {
          const detail = failures
            .map((f) => `${f.date}: ${f.error} [${f.names.join(" | ")}]`)
            .join("\n");
          messages.push({
            quiet: false,
            message:
              `Scrape could not parse ${failures.length} day(s), degraded to unknown rules:\n${detail}`.slice(
                0,
                1800,
              ),
          });
        }
        const unknownDates = result.flatMap((y) =>
          y.rules
            .filter((r) => r.type === "unknown_rules")
            .map((r) => `${r.start_date}..${r.end_date}`),
        );
        if (unknownDates.length > 0) {
          messages.push({
            quiet: false,
            message:
              `Scrape has unknown rules for: ${unknownDates.join(", ")}`.slice(
                0,
                1800,
              ),
          });
        }
        return messages;
      }
    });

    for (const [i, { quiet, message }] of logMessages.entries()) {
      console.log(message);
      if (!quiet) {
        // Indexed rather than named after the message: messages can now be
        // long and multi-line, and step names need to stay short and stable
        // across replays.
        await step.do(`discordReport ${i}`, async () =>
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

    const patchedResult = await step.do("applyPatches", async () =>
      applyScrapePatches(result, await loadScrapePatches(this.env)),
    );

    await Promise.all(
      webhooks.map(async (row, i) => {
        const claimed = await step.do(
          `claimWebhookRow ${i} ${row.webhook_url} ${row.last_update_utc} < ${today}`,
          async () => claimWebhookRow(this.env, today, row.webhook_url),
        );
        if (claimed) {
          await step.do(
            `postWebhookRow ${i} ${row.webhook_url} ${today}`,
            async () => postWebhookRow(this.env, today, patchedResult, row),
          );
        }
      }),
    );

    return logMessages.map((msg) => msg.message);
  }
}
