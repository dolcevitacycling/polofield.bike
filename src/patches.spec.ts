import { describe, it, expect } from "vitest";
import {
  applyScrapePatches,
  canonicalJson,
  findRuleForDate,
  type ScrapePatch,
} from "./patches";
import type { KnownRules, ScrapeResult } from "./cron";

const may17Rule: KnownRules = {
  type: "known_rules",
  text: "2026-05-17",
  start_date: "2026-05-17",
  end_date: "2026-05-17",
  intervals: [
    {
      open: true,
      start_timestamp: "2026-05-17 00:00",
      end_timestamp: "2026-05-17 23:59",
    },
  ],
  rules: ["Cycle Track Open All Day"],
};

const may18Patch: KnownRules = {
  type: "known_rules",
  text: "2026-05-18",
  start_date: "2026-05-18",
  end_date: "2026-05-18",
  intervals: [
    {
      open: true,
      start_timestamp: "2026-05-18 00:00",
      end_timestamp: "2026-05-18 23:59",
    },
  ],
  rules: ["[polofield.bike patch] Assumed Cycle Track Open All Day"],
};

function baseResult(): ScrapeResult {
  return [{ type: "year", year: 2026, rules: [may17Rule] }];
}

function patch(overrides: Partial<ScrapePatch> = {}): ScrapePatch {
  return {
    date: "2026-05-18",
    expected_rule: null,
    patch_rule: may18Patch,
    note: null,
    created_at: "2026-05-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { y: 2, x: 1 } })).toBe(
      '{"a":{"x":1,"y":2},"b":1}',
    );
  });
  it("handles null/arrays/primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe("applyScrapePatches", () => {
  it("applies a patch when expected_rule matches the current (null) rule", () => {
    const result = applyScrapePatches(baseResult(), [patch()]);
    expect(findRuleForDate(result, "2026-05-18")).toEqual(may18Patch);
  });

  it("does not apply a patch when expected_rule no longer matches", () => {
    const upstream: KnownRules = {
      type: "known_rules",
      text: "2026-05-18",
      start_date: "2026-05-18",
      end_date: "2026-05-18",
      intervals: [
        {
          open: true,
          start_timestamp: "2026-05-18 00:00",
          end_timestamp: "2026-05-18 23:59",
        },
      ],
      rules: ["Cycle Track Open All Day"],
    };
    const result = applyScrapePatches(
      [{ type: "year", year: 2026, rules: [may17Rule, upstream] }],
      [patch()],
    );
    expect(findRuleForDate(result, "2026-05-18")).toEqual(upstream);
  });

  it("matches when key ordering of expected_rule differs", () => {
    // Same content as may17Rule but with shuffled key order in expected_rule
    const expected = JSON.parse(
      JSON.stringify({
        rules: may17Rule.rules,
        intervals: may17Rule.intervals,
        end_date: may17Rule.end_date,
        start_date: may17Rule.start_date,
        text: may17Rule.text,
        type: may17Rule.type,
      }),
    );
    const override: KnownRules = {
      ...may17Rule,
      rules: ["Field Rained Out"],
    };
    const result = applyScrapePatches(baseResult(), [
      patch({
        date: "2026-05-17",
        expected_rule: expected,
        patch_rule: { ...override, start_date: "2026-05-17", end_date: "2026-05-17", text: "2026-05-17" },
      }),
    ]);
    const got = findRuleForDate(result, "2026-05-17");
    expect(got?.rules).toEqual(["Field Rained Out"]);
  });

  it("creates a year container if the patch year is not in the result", () => {
    const result = applyScrapePatches([], [patch()]);
    expect(result).toEqual([
      { type: "year", year: 2026, rules: [may18Patch] },
    ]);
  });

  it("returns the original result if no patches apply", () => {
    const orig = baseResult();
    const out = applyScrapePatches(orig, [
      patch({ expected_rule: may17Rule }), // expected null but current is may17Rule? no — for date 2026-05-18 current is null, expected may17Rule, no match
    ]);
    expect(out).toBe(orig);
  });
});
