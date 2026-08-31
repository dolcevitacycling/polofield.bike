import { describe, it, expect } from "vitest";
import {
  decideOnFailure,
  decideOnSuccess,
  describeHealth,
  INITIAL_HEALTH,
  REALERT_AFTER_MS,
  STALE_AFTER_MS,
  type ScrapeHealth,
} from "./health";

const CRON_INTERVAL_MS = 20 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const START = Date.parse("2026-08-30T07:00:00.000Z");
const at = (tick: number) =>
  new Date(START + tick * CRON_INTERVAL_MS).toISOString();
const ticksFor = (ms: number) => Math.ceil(ms / CRON_INTERVAL_MS);

/** Replays an outage at the real cron cadence, starting from a healthy scrape. */
function outageOf(hours: number) {
  let health: ScrapeHealth = { ...INITIAL_HEALTH, last_success_at: at(0) };
  const alerts: number[] = [];
  const runs = ticksFor(hours * HOUR_MS);
  for (let tick = 1; tick <= runs; tick++) {
    const decision = decideOnFailure(health, at(tick));
    if (decision.alert) alerts.push(tick);
    health = decision.next;
  }
  return { health, alerts, runs };
}

describe("decideOnFailure", () => {
  it("says nothing for the 40 minute glitches sfrecpark serves routinely", () => {
    // The outage behind POLOFIELD-2: three consecutive failed runs.
    expect(outageOf(1).alerts).toEqual([]);
  });

  it("stays silent right up to the staleness threshold", () => {
    const justUnder = STALE_AFTER_MS / HOUR_MS - CRON_INTERVAL_MS / HOUR_MS;
    expect(outageOf(justUnder).alerts).toEqual([]);
  });

  it("alerts once the data is genuinely stale", () => {
    const { alerts } = outageOf(STALE_AFTER_MS / HOUR_MS);
    expect(alerts).toHaveLength(1);
  });

  it("measures staleness from the last success, not the run count", () => {
    // A single failure long after the last success is stale immediately,
    // however few runs have failed — which is what matters when runs are
    // skipped rather than failing.
    const stale = decideOnFailure(
      { ...INITIAL_HEALTH, last_success_at: at(0) },
      new Date(START + STALE_AFTER_MS).toISOString(),
    );
    expect(stale.failures).toBe(1);
    expect(stale.alert).toBe(true);
  });

  it("keeps an all day outage to a couple of alerts", () => {
    const { alerts } = outageOf(24);
    expect(alerts.length).toBeLessThanOrEqual(
      Math.ceil((24 * HOUR_MS) / REALERT_AFTER_MS),
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the start of the outage for the down since report", () => {
    const { health, runs } = outageOf(2);
    expect(health.first_failure_at).toBe(at(1));
    expect(health.consecutive_failures).toBe(runs);
  });

  it("does not alert immediately on a fresh database that has never succeeded", () => {
    const first = decideOnFailure(INITIAL_HEALTH, at(0));
    expect(first.alert).toBe(false);
    expect(first.staleMs).toBe(0);
  });
});

describe("decideOnSuccess", () => {
  it("says nothing when recovering from a glitch nobody was told about", () => {
    const { health } = outageOf(1);
    expect(decideOnSuccess(health, at(99)).recovered).toBe(false);
  });

  it("announces recovery from an outage that was alerted", () => {
    const { health } = outageOf(STALE_AFTER_MS / HOUR_MS);
    expect(decideOnSuccess(health, at(99)).recovered).toBe(true);
  });

  it("resets the counters so the next glitch starts clean", () => {
    const { health } = outageOf(8);
    expect(decideOnSuccess(health, at(99)).next).toEqual({
      last_success_at: at(99),
      consecutive_failures: 0,
      first_failure_at: null,
      last_alert_at: null,
      last_strategy: null,
      last_attempts_json: null,
    });
  });

  it("records which request shape worked, and reports only the change", () => {
    // The question we could not answer about the 2026-08-30 recovery: was it
    // the fallback or the origin? One report on the switch, then silence
    // while it stays there — /health carries the current answer.
    const attempts = [{ strategy: "current", status: 522 }];
    let health: ScrapeHealth = { ...INITIAL_HEALTH, last_success_at: at(0) };
    const fellBack = decideOnSuccess(health, at(1), {
      strategy: "browser-ua",
      attempts,
    });
    expect(fellBack.strategyChanged).toBe(true);
    expect(fellBack.previousStrategy).toBe(null);
    expect(fellBack.next.last_strategy).toBe("browser-ua");
    expect(JSON.parse(fellBack.next.last_attempts_json!)).toEqual(attempts);

    health = fellBack.next;
    const stillFallenBack = decideOnSuccess(health, at(2), {
      strategy: "browser-ua",
      attempts,
    });
    expect(stillFallenBack.strategyChanged).toBe(false);

    // Coming back to the plain request is a change worth hearing about too.
    const backToNormal = decideOnSuccess(stillFallenBack.next, at(3), {
      strategy: "current",
      attempts: [],
    });
    expect(backToNormal.strategyChanged).toBe(true);
    expect(backToNormal.previousStrategy).toBe("browser-ua");
  });

  it("keeps the recorded shape through an outage, so the change is real", () => {
    // decideOnFailure must not clear it: otherwise every recovery looks like
    // a strategy change and the report means nothing.
    const succeeded = decideOnSuccess(INITIAL_HEALTH, at(0), {
      strategy: "browser-ua",
      attempts: [],
    });
    const failed = decideOnFailure(succeeded.next, at(1));
    expect(failed.next.last_strategy).toBe("browser-ua");
  });

  it("stays quiet through a flapping origin that never fails for long", () => {
    let health: ScrapeHealth = { ...INITIAL_HEALTH, last_success_at: at(0) };
    const reported: string[] = [];
    for (let tick = 1; tick < 200; tick++) {
      if (tick % 2 === 0) {
        const decision = decideOnFailure(health, at(tick));
        if (decision.alert) reported.push(`alert@${tick}`);
        health = decision.next;
      } else {
        const decision = decideOnSuccess(health, at(tick));
        if (decision.recovered) reported.push(`recovery@${tick}`);
        health = decision.next;
      }
    }
    expect(reported).toEqual([]);
  });
});

describe("describeHealth", () => {
  it("reports healthy while the scrape is keeping up", () => {
    expect(
      describeHealth(
        { ...INITIAL_HEALTH, last_success_at: at(0) },
        new Date(START + CRON_INTERVAL_MS).toISOString(),
      ),
    ).toEqual({
      healthy: true,
      stale_seconds: CRON_INTERVAL_MS / 1000,
      last_success_at: at(0),
      consecutive_failures: 0,
      failing_since: null,
      last_strategy: null,
    });
  });

  it("reports unhealthy once the data is stale, so /health can 503", () => {
    const summary = describeHealth(
      { ...INITIAL_HEALTH, last_success_at: at(0) },
      new Date(START + STALE_AFTER_MS).toISOString(),
    );
    expect(summary.healthy).toBe(false);
    expect(summary.stale_seconds).toBe(STALE_AFTER_MS / 1000);
  });

  it("goes unhealthy when the cron stops running, with no failures recorded", () => {
    // Nothing runs, so consecutive_failures stays 0 and no alert can ever
    // fire; only something reading this at request time notices.
    const summary = describeHealth(
      { ...INITIAL_HEALTH, last_success_at: at(0) },
      new Date(START + 3 * STALE_AFTER_MS).toISOString(),
    );
    expect(summary).toMatchObject({ healthy: false, consecutive_failures: 0 });
  });
});
