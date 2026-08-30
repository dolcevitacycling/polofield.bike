import type { Bindings } from "./types";

/**
 * Scrape health, so upstream glitches can be told apart from real outages.
 *
 * sfrecpark.org returns 522s and other transient errors often enough that
 * alerting on the first failed run is noise: by the next cron tick it is
 * usually fine again. Parse failures are the opposite — they are deterministic
 * and need a code change — so those still report immediately (see
 * recognizeCalendarDate and the workflow's captureUnrecognized step).
 *
 * The decision logic is kept pure and the persistence thin, so the thresholds
 * are testable without a database.
 */

/** The cron runs every 20 minutes, so this is roughly an hour of failure. */
export const FAILURES_BEFORE_ALERT = 3;

/** How long to stay quiet before repeating an alert for an ongoing outage. */
export const REALERT_AFTER_MS = 6 * 60 * 60 * 1000;

export interface ScrapeHealth {
  readonly last_success_at: string | null;
  readonly consecutive_failures: number;
  readonly first_failure_at: string | null;
  readonly last_alert_at: string | null;
}

export const INITIAL_HEALTH: ScrapeHealth = {
  last_success_at: null,
  consecutive_failures: 0,
  first_failure_at: null,
  last_alert_at: null,
};

export interface FailureDecision {
  /** Consecutive failed runs including this one. */
  readonly failures: number;
  /** When the current run of failures started. */
  readonly downSince: string;
  /** Whether this failure is worth telling a human about. */
  readonly alert: boolean;
  readonly next: ScrapeHealth;
}

export function decideOnFailure(
  health: ScrapeHealth,
  nowISO: string,
): FailureDecision {
  const failures = health.consecutive_failures + 1;
  const downSince = health.first_failure_at ?? nowISO;
  const lastAlert = health.last_alert_at
    ? Date.parse(health.last_alert_at)
    : null;
  const alert =
    failures >= FAILURES_BEFORE_ALERT &&
    (lastAlert === null || Date.parse(nowISO) - lastAlert >= REALERT_AFTER_MS);
  return {
    failures,
    downSince,
    alert,
    next: {
      last_success_at: health.last_success_at,
      consecutive_failures: failures,
      first_failure_at: downSince,
      // Only move the clock when we actually alert, so the re-alert interval
      // is measured from the last thing a human saw.
      last_alert_at: alert ? nowISO : health.last_alert_at,
    },
  };
}

export interface SuccessDecision {
  /** True only for outages we alerted about, so a blip stays silent. */
  readonly recovered: boolean;
  readonly failures: number;
  readonly downSince: string | null;
  readonly next: ScrapeHealth;
}

export function decideOnSuccess(
  health: ScrapeHealth,
  nowISO: string,
): SuccessDecision {
  return {
    recovered: health.last_alert_at !== null,
    failures: health.consecutive_failures,
    downSince: health.first_failure_at,
    next: {
      last_success_at: nowISO,
      consecutive_failures: 0,
      first_failure_at: null,
      last_alert_at: null,
    },
  };
}

export async function readScrapeHealth(env: Bindings): Promise<ScrapeHealth> {
  const row = await env.DB.prepare(
    `SELECT last_success_at, consecutive_failures, first_failure_at, last_alert_at FROM scrape_health WHERE id = 1`,
  ).first<ScrapeHealth>();
  return row ?? INITIAL_HEALTH;
}

async function writeScrapeHealth(
  env: Bindings,
  health: ScrapeHealth,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scrape_health (id, last_success_at, consecutive_failures, first_failure_at, last_alert_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_success_at = excluded.last_success_at,
         consecutive_failures = excluded.consecutive_failures,
         first_failure_at = excluded.first_failure_at,
         last_alert_at = excluded.last_alert_at`,
  )
    .bind(
      health.last_success_at,
      health.consecutive_failures,
      health.first_failure_at,
      health.last_alert_at,
    )
    .run();
}

export async function recordScrapeFailure(
  env: Bindings,
  nowISO: string = new Date().toISOString(),
): Promise<FailureDecision> {
  const decision = decideOnFailure(await readScrapeHealth(env), nowISO);
  await writeScrapeHealth(env, decision.next);
  return decision;
}

export async function recordScrapeSuccess(
  env: Bindings,
  nowISO: string = new Date().toISOString(),
): Promise<SuccessDecision> {
  const decision = decideOnSuccess(await readScrapeHealth(env), nowISO);
  await writeScrapeHealth(env, decision.next);
  return decision;
}
