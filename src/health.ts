import type { Bindings } from "./types";

/**
 * Scrape health, so upstream glitches can be told apart from real outages.
 *
 * sfrecpark.org serves 522s often, and for stretches of half an hour or more,
 * so counting failed runs is the wrong measure — it alerts on outages that fix
 * themselves. What actually matters is whether the data has gone stale: the
 * site serves the last good scrape, the schedule rarely changes within a day,
 * and the bots post once a day. So alert on how long it has been since a
 * successful scrape, and stay quiet while the gap is one the site rides out.
 *
 * Parse failures are the opposite — deterministic, and needing a code change —
 * so those still report immediately (see the workflow's captureUnrecognized).
 */

/** How stale the scrape has to get before it is worth telling a human. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** How long to stay quiet before repeating an alert for an ongoing outage. */
export const REALERT_AFTER_MS = 12 * 60 * 60 * 1000;

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

/**
 * How long the scrape has been failing: since the last success, or since the
 * first failure if it has never succeeded (a fresh database should not look
 * infinitely stale).
 */
export function staleForMs(health: ScrapeHealth, nowISO: string): number {
  const since = health.last_success_at ?? health.first_failure_at;
  return since === null
    ? 0
    : Math.max(0, Date.parse(nowISO) - Date.parse(since));
}

export interface HealthSummary {
  readonly healthy: boolean;
  readonly stale_seconds: number;
  readonly last_success_at: string | null;
  readonly consecutive_failures: number;
  readonly failing_since: string | null;
}

/** The shape served by /health and /status.json. */
export function describeHealth(
  health: ScrapeHealth,
  nowISO: string,
): HealthSummary {
  const stale = staleForMs(health, nowISO);
  return {
    healthy: stale < STALE_AFTER_MS,
    stale_seconds: Math.round(stale / 1000),
    last_success_at: health.last_success_at,
    consecutive_failures: health.consecutive_failures,
    failing_since:
      health.consecutive_failures > 0 ? health.first_failure_at : null,
  };
}

export interface FailureDecision {
  readonly failures: number;
  readonly downSince: string;
  readonly staleMs: number;
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
  const staleMs = staleForMs(
    { ...health, first_failure_at: downSince },
    nowISO,
  );
  const lastAlert = health.last_alert_at
    ? Date.parse(health.last_alert_at)
    : null;
  const alert =
    staleMs >= STALE_AFTER_MS &&
    (lastAlert === null || Date.parse(nowISO) - lastAlert >= REALERT_AFTER_MS);
  return {
    failures,
    downSince,
    staleMs,
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
