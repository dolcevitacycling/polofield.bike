import type {
  KnownRules,
  ScrapeResult,
  UnknownRules,
  Year,
} from "./cron";
import type { Bindings } from "./types";

export interface ScrapePatchRow {
  readonly date: string;
  readonly expected_rule_json: string;
  readonly patch_rule_json: string;
  readonly note: string | null;
  readonly created_at: string;
}

export type ExistingRule = KnownRules | UnknownRules;

export interface ScrapePatch {
  readonly date: string;
  readonly expected_rule: ExistingRule | null;
  readonly patch_rule: KnownRules;
  readonly note: string | null;
  readonly created_at: string;
}

export async function loadScrapePatches(env: Bindings): Promise<ScrapePatch[]> {
  const rows = await env.DB.prepare(
    `SELECT date, expected_rule_json, patch_rule_json, note, created_at FROM scrape_patches ORDER BY date`,
  ).all<ScrapePatchRow>();
  return rows.results.map(parsePatchRow);
}

export function parsePatchRow(row: ScrapePatchRow): ScrapePatch {
  return {
    date: row.date,
    expected_rule: JSON.parse(row.expected_rule_json),
    patch_rule: JSON.parse(row.patch_rule_json),
    note: row.note,
    created_at: row.created_at,
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function findRuleForDate(
  result: ScrapeResult,
  date: string,
): ExistingRule | null {
  const year = parseInt(date.split("-")[0], 10);
  for (const sched of result) {
    if (sched.year !== year) continue;
    for (const rule of sched.rules) {
      if (rule.start_date <= date && rule.end_date >= date) {
        return rule;
      }
    }
  }
  return null;
}

export function applyScrapePatches(
  result: ScrapeResult,
  patches: readonly ScrapePatch[],
): ScrapeResult {
  const applicable = patches.filter(
    (p) =>
      canonicalJson(findRuleForDate(result, p.date)) ===
      canonicalJson(p.expected_rule),
  );
  if (applicable.length === 0) return result;

  const byYear = new Map<number, KnownRules[]>();
  for (const p of applicable) {
    const year = parseInt(p.date.split("-")[0], 10);
    const arr = byYear.get(year) ?? [];
    arr.push(p.patch_rule);
    byYear.set(year, arr);
  }

  // Prepend patches so they take precedence over any existing rule covering
  // the same date (intervalsForDate / findRuleForDate return the first match).
  const out: Year<KnownRules | UnknownRules>[] = result.map((y) => {
    const extra = byYear.get(y.year);
    return extra ? { ...y, rules: [...extra, ...y.rules] } : y;
  });
  const existingYears = new Set(result.map((y) => y.year));
  for (const [year, rules] of byYear) {
    if (!existingYears.has(year)) {
      out.push({ type: "year", year, rules });
    }
  }
  return out;
}
