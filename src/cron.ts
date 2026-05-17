import { parseDate, addDays, getTodayPacific, shortDateStyle } from "./dates";
import { discordReport, runDiscordWebhook } from "./discord";
import { CalendarScraper, currentCalendarUrl } from "./scrapeCalendar";
import { runSlackWebhook } from "./slack";
import { Bindings } from "./types";
import { fetchFieldRainoutInfo } from "./scrapeFieldRainoutInfo";
import { applyScrapePatches, loadScrapePatches } from "./patches";

export const POLO_URL = "https://www.sfrecpark.org/526/Polo-Field-Usage";

export interface Year<T> {
  readonly type: "year";
  readonly year: number;
  readonly rules: T[];
}

export type RecognizerRules =
  | { readonly recognizer: null; readonly rules: UnknownRules }
  | { readonly recognizer: Recognizer; readonly rules: KnownRules };

export type ScrapeResult = Year<UnknownRules | KnownRules>[];
export type ScrapeDebugResult = Year<RecognizerRules>[];
export interface UnknownRules {
  readonly type: "unknown_rules";
  readonly text: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly rules: string[];
}

export interface KnownRules extends Omit<UnknownRules, "type"> {
  readonly type: "known_rules";
  readonly intervals: RuleInterval[];
}

export interface RuleInterval {
  readonly open: boolean;
  readonly start_timestamp: string;
  readonly end_timestamp: string;
  readonly comment?: string;
}

export type Recognizer = {
  (rule: UnknownRules): KnownRules | undefined;
  name: string;
};

export function intervalsForDate(
  result: ScrapeResult,
  date: string,
):
  | {
      readonly type: "known";
      readonly intervals: RuleInterval[];
      readonly rule: KnownRules;
    }
  | { readonly type: "unknown"; readonly rule: UnknownRules }
  | undefined {
  let maxYear: number | null = null;
  const year = parseInt(date.split("-")[0], 10);
  for (const sched of result) {
    maxYear = Math.max(maxYear ?? sched.year, sched.year);
    if (sched.year !== year) {
      continue;
    }
    for (const rule of sched.rules) {
      if (rule.start_date <= date && rule.end_date >= date) {
        if (rule.type === "unknown_rules") {
          return { type: "unknown", rule };
        }
        const intervals = rule.intervals.filter(
          (interval) =>
            interval.start_timestamp.split(" ")[0] <= date &&
            interval.end_timestamp.split(" ")[0] >= date,
        );
        return { type: "known", intervals, rule };
      }
    }
  }
  if (maxYear !== null) {
    const nextYear = maxYear + 1;
    const jan1 = `${nextYear}-01-01`;
    const jan31 = `${nextYear}-01-31`;
    if (date >= jan1 && date <= jan31) {
      const intervals = [
        {
          start_timestamp: `${jan1} 00:00`,
          end_timestamp: `${jan31} 23:59`,
          open: true,
        },
      ];
      return {
        type: "known",
        intervals,
        rule: {
          type: "known_rules",
          intervals,
          text: `January ${nextYear}`,
          rules: [
            "[polofield.bike assumption] PF is historically open all January",
          ],
          start_date: jan1,
          end_date: jan31,
        },
      };
    }
  }
  return undefined;
}

export async function scrapePoloURL(): Promise<ScrapeResult> {
  const scraper = new CalendarScraper();
  const res = new HTMLRewriter().on("*", scraper).transform(
    await fetch(currentCalendarUrl(), {
      cache: "no-store",
      headers: { "user-agent": "polofield.bike" },
    }),
  );
  await res.text();
  const oldestYear =
    Math.min(...scraper.years.map((y) => y.year)) || new Date().getFullYear();
  scraper.fieldRainoutInfo = await fetchFieldRainoutInfo(oldestYear);
  return scraper.getResult();
}

export interface ScrapeResultsRow {
  readonly created_at: string;
  readonly scrape_results_json: string;
}

export interface CachedScrapeResult {
  readonly created_at: string;
  readonly scrape_results: ScrapeResult;
}

export async function recentScrapedResults(
  env: Bindings,
  limit = 1000,
): Promise<CachedScrapeResult[]> {
  return (
    await env.DB.prepare(
      `SELECT created_at, scrape_results_json FROM scrape_results ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all<ScrapeResultsRow>()
  ).results.map(({ created_at, scrape_results_json }) => ({
    created_at,
    scrape_results: JSON.parse(scrape_results_json),
  }));
}

export async function cachedScrapeResult(
  env: Bindings,
): Promise<CachedScrapeResult> {
  const results = await recentScrapedResults(env, 1);
  const base =
    results.length === 0
      ? (console.error(`Expected cached row in scraped_results`),
        await refreshScrapeResult(env))
      : results[0];
  const patches = await loadScrapePatches(env);
  return {
    created_at: base.created_at,
    scrape_results: applyScrapePatches(base.scrape_results, patches),
  };
}

export async function refreshScrapeResult(
  env: Bindings,
  { log }: { readonly log?: boolean } = {},
): Promise<CachedScrapeResult> {
  const result = await scrapePoloURL();
  const prev = await env.DB.prepare(
    `SELECT created_at, scrape_results_json FROM scrape_results ORDER BY created_at DESC LIMIT 1`,
  ).all<ScrapeResultsRow>();
  const created_at = new Date().toISOString();
  const scrape_results_json = JSON.stringify(result);
  if (
    prev.results.length > 0 &&
    prev.results[0].scrape_results_json === scrape_results_json
  ) {
    if (log) {
      console.log(
        `No change since ${prev.results[0].created_at}, skipping ${created_at}`,
      );
    }
    return {
      created_at: prev.results[0].created_at,
      scrape_results: JSON.parse(prev.results[0].scrape_results_json),
    };
  } else if (result.length === 0 && prev.results.length > 0) {
    if (log) {
      console.log(`Error detected when scraping, skipping ${created_at}`);
      await discordReport(
        env,
        `Error detected when scraping, skipping ${created_at}`,
      );
    }
    return {
      created_at: prev.results[0].created_at,
      scrape_results: JSON.parse(prev.results[0].scrape_results_json),
    };
  } else {
    await env.DB.prepare(
      `INSERT INTO scrape_results (created_at, scrape_results_json) VALUES (?, ?)`,
    )
      .bind(created_at, scrape_results_json)
      .run();
    if (log) {
      console.log(`Inserted new scrape result at ${created_at}`);
      await discordReport(env, `Inserted new scrape result at ${created_at}`);
    }
    return { created_at, scrape_results: result };
  }
}

export async function bootstrapWebhooks(env: Bindings): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    console.log("no discord webhook url");
    return;
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_webhook_status (webhook_url, params_json, last_update_utc) VALUES (?, ?, '1970-01-01')`,
  )
    .bind(env.DISCORD_WEBHOOK_URL, JSON.stringify({ type: "discord" }))
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO daily_webhook_status (webhook_url, params_json, last_update_utc) VALUES (?, ?, '1970-01-01')`,
  )
    .bind("slack://", JSON.stringify({ type: "slack:chat.postMessage" }))
    .run();
}

export type DailyWebhookStatusRow = Record<
  "webhook_url" | "last_update_utc" | "params_json",
  string
>;

// Atomic "claim": flips last_update_utc forward iff the row hasn't been claimed
// today yet. Returns true if this caller acquired the right to post.
export async function claimWebhookRow(
  env: Bindings,
  today: string,
  webhook_url: string,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE daily_webhook_status SET last_update_utc = ? WHERE webhook_url = ? AND last_update_utc < ?`,
  )
    .bind(today, webhook_url, today)
    .run();
  return res.meta.changes === 1;
}

export async function postWebhookRow(
  env: Bindings,
  today: string,
  scrape_results: ScrapeResult,
  row: DailyWebhookStatusRow,
): Promise<void> {
  const tomorrow = addDays(parseDate(today), 1);
  const params = JSON.parse(row.params_json);
  let payload: unknown;
  let response: unknown;
  if (params.type === "discord") {
    ({ payload, response } = await runDiscordWebhook(env, {
      webhook_url: row.webhook_url,
      date: tomorrow,
      params: params,
      scrape_results,
    }));
  } else if (params.type === "slack:chat.postMessage") {
    ({ payload, response } = await runSlackWebhook(env, {
      webhook_url: row.webhook_url,
      date: tomorrow,
      params: params,
      scrape_results,
    }));
  } else {
    throw new Error(`Unknown webhook type: ${params.type}`);
  }
  await env.DB.prepare(
    `UPDATE daily_webhook_status
       SET last_post_date = ?, last_post_at = ?, last_post_payload_json = ?, last_post_response_json = ?
       WHERE webhook_url = ?`,
  )
    .bind(
      shortDateStyle.format(tomorrow),
      new Date().toISOString(),
      JSON.stringify(payload),
      JSON.stringify(response),
      row.webhook_url,
    )
    .run();
}

export async function runWebhooks(
  env: Bindings,
  { scrape_results }: CachedScrapeResult,
): Promise<void> {
  // Shift to reporting the next day at 4pm instead of midnight
  const now = new Date();
  now.setHours(now.getHours() - 16);
  const today = getTodayPacific(now);
  const rows = await env.DB.prepare(
    `SELECT webhook_url, params_json, last_update_utc FROM daily_webhook_status WHERE last_update_utc < ?`,
  )
    .bind(today)
    .all<DailyWebhookStatusRow>();
  await Promise.allSettled(
    rows.results.map(async (row) => {
      if (await claimWebhookRow(env, today, row.webhook_url)) {
        await postWebhookRow(env, today, scrape_results, row);
      }
    }),
  );
}

export async function cronBody(env: Bindings): Promise<CachedScrapeResult> {
  const result = await refreshScrapeResult(env, { log: true });
  await bootstrapWebhooks(env);
  await runWebhooks(env, result);
  return result;
}

export async function handleCron(
  event: ScheduledController,
  env: Bindings,
): Promise<void> {
  // await cronBody(env);
  const workflow = await env.SCRAPE_POLO_WORKFLOW.create();
  console.log(`Cron created workflow id ${workflow.id}`);
}
