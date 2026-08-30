import { describe, it, expect } from "vitest";
import {
  decideOnFailure,
  decideOnSuccess,
  FAILURES_BEFORE_ALERT,
  INITIAL_HEALTH,
  REALERT_AFTER_MS,
  type ScrapeHealth,
} from "./health";

const CRON_INTERVAL_MS = 20 * 60 * 1000;
const START = Date.parse("2026-08-30T07:00:00.000Z");
const at = (tick: number) =>
  new Date(START + tick * CRON_INTERVAL_MS).toISOString();

/** Replays consecutive failed runs at the real cron cadence. */
function failFor(runs: number, from: ScrapeHealth = INITIAL_HEALTH) {
  let health = from;
  const alerts: number[] = [];
  for (let tick = 0; tick < runs; tick++) {
    const decision = decideOnFailure(health, at(tick));
    if (decision.alert) alerts.push(tick);
    health = decision.next;
  }
  return { health, alerts };
}

describe("decideOnFailure", () => {
  it("stays silent for a single glitch", () => {
    const { alerts } = failFor(1);
    expect(alerts).toEqual([]);
  });

  it("stays silent right up to the threshold", () => {
    const { alerts } = failFor(FAILURES_BEFORE_ALERT - 1);
    expect(alerts).toEqual([]);
  });

  it("alerts once the outage is sustained", () => {
    const { alerts } = failFor(FAILURES_BEFORE_ALERT);
    expect(alerts).toEqual([FAILURES_BEFORE_ALERT - 1]);
  });

  it("does not repeat every run while the outage continues", () => {
    // A full day of failures at 20 minute intervals.
    const { alerts } = failFor(72);
    // First alert at the threshold, then only on the slow re-alert cadence.
    expect(alerts[0]).toBe(FAILURES_BEFORE_ALERT - 1);
    const perDay = Math.floor((72 * CRON_INTERVAL_MS) / REALERT_AFTER_MS);
    expect(alerts.length).toBeLessThanOrEqual(perDay + 1);
    expect(alerts.length).toBeGreaterThan(1);
  });

  it("keeps the start of the outage for the down since report", () => {
    const { health } = failFor(5);
    expect(health.first_failure_at).toBe(at(0));
    expect(health.consecutive_failures).toBe(5);
  });

  it("re-alerts only after the quiet period", () => {
    const alerted = failFor(FAILURES_BEFORE_ALERT).health;
    const justUnder = decideOnFailure(
      alerted,
      new Date(
        Date.parse(alerted.last_alert_at!) + REALERT_AFTER_MS - 1,
      ).toISOString(),
    );
    expect(justUnder.alert).toBe(false);
    const justOver = decideOnFailure(
      alerted,
      new Date(
        Date.parse(alerted.last_alert_at!) + REALERT_AFTER_MS,
      ).toISOString(),
    );
    expect(justOver.alert).toBe(true);
  });
});

describe("decideOnSuccess", () => {
  it("says nothing when recovering from a glitch nobody was told about", () => {
    const { health } = failFor(FAILURES_BEFORE_ALERT - 1);
    expect(decideOnSuccess(health, at(9)).recovered).toBe(false);
  });

  it("announces recovery from an outage that was alerted", () => {
    const { health } = failFor(FAILURES_BEFORE_ALERT);
    const decision = decideOnSuccess(health, at(9));
    expect(decision.recovered).toBe(true);
    expect(decision.failures).toBe(FAILURES_BEFORE_ALERT);
    expect(decision.downSince).toBe(at(0));
  });

  it("resets the counters so the next glitch starts clean", () => {
    const { health } = failFor(10);
    expect(decideOnSuccess(health, at(11)).next).toEqual({
      last_success_at: at(11),
      consecutive_failures: 0,
      first_failure_at: null,
      last_alert_at: null,
    });
  });

  it("stays quiet through a flapping origin that never fails twice running", () => {
    // Fail, recover, fail, recover... which is what a glitchy origin looks
    // like. Nothing should ever be reported.
    let health = INITIAL_HEALTH;
    const reported: string[] = [];
    for (let tick = 0; tick < 100; tick++) {
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
