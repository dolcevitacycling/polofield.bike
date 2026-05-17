import { Context } from "hono";
import type { Bindings } from "./types";
import {
  canonicalJson,
  findRuleForDate,
  loadScrapePatches,
  type ExistingRule,
} from "./patches";
import { cachedScrapeResult, recentScrapedResults, type KnownRules } from "./cron";

function isAuthorized(c: Context<{ Bindings: Bindings }>): boolean {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return false;
  const header = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const provided = m[1];
  // constant-time compare
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateKnownRules(date: string, value: unknown): KnownRules {
  if (!value || typeof value !== "object") {
    throw new Error("patch_rule must be a KnownRules object");
  }
  const r = value as Record<string, unknown>;
  if (r.type !== "known_rules") {
    throw new Error(`patch_rule.type must be "known_rules"`);
  }
  if (r.start_date !== date || r.end_date !== date) {
    throw new Error(
      `patch_rule.start_date and end_date must equal patch date ${date}`,
    );
  }
  if (!Array.isArray(r.intervals) || r.intervals.length === 0) {
    throw new Error("patch_rule.intervals must be a non-empty array");
  }
  if (!Array.isArray(r.rules)) {
    throw new Error("patch_rule.rules must be an array");
  }
  if (typeof r.text !== "string") {
    throw new Error("patch_rule.text must be a string");
  }
  return value as KnownRules;
}

export async function listPatches(c: Context<{ Bindings: Bindings }>) {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const patches = await loadScrapePatches(c.env);
  const recent = await recentScrapedResults(c.env, 1);
  const baseResult = recent[0]?.scrape_results ?? [];
  return c.json(
    patches.map((p) => {
      const currentRule = findRuleForDate(baseResult, p.date);
      const active =
        canonicalJson(currentRule) === canonicalJson(p.expected_rule);
      return { ...p, current_rule: currentRule, active };
    }),
  );
}

export async function upsertPatch(c: Context<{ Bindings: Bindings }>) {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }
  const b = body as Record<string, unknown>;
  if (typeof b.date !== "string" || !DATE_RE.test(b.date)) {
    return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  }
  const date = b.date;
  if (!("patch_rule" in b)) {
    return c.json({ error: "patch_rule is required" }, 400);
  }
  let patch_rule: KnownRules;
  try {
    patch_rule = validateKnownRules(date, b.patch_rule);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  if (!("expected_rule" in b)) {
    return c.json(
      { error: "expected_rule is required (use null for unpopulated dates)" },
      400,
    );
  }
  const expected_rule = b.expected_rule as ExistingRule | null;
  const note = typeof b.note === "string" ? b.note : null;
  const created_at = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO scrape_patches (date, expected_rule_json, patch_rule_json, note, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       expected_rule_json = excluded.expected_rule_json,
       patch_rule_json = excluded.patch_rule_json,
       note = excluded.note,
       created_at = excluded.created_at`,
  )
    .bind(
      date,
      JSON.stringify(expected_rule),
      JSON.stringify(patch_rule),
      note,
      created_at,
    )
    .run();
  const { scrape_results } = await cachedScrapeResult(c.env);
  return c.json({
    date,
    expected_rule,
    patch_rule,
    note,
    created_at,
    effective_rule: findRuleForDate(scrape_results, date),
  });
}

export async function deletePatch(c: Context<{ Bindings: Bindings }>) {
  if (!isAuthorized(c)) return c.json({ error: "Unauthorized" }, 401);
  const date = c.req.param("date");
  if (!date || !DATE_RE.test(date)) {
    return c.json({ error: "date must be YYYY-MM-DD" }, 400);
  }
  const res = await c.env.DB.prepare(
    `DELETE FROM scrape_patches WHERE date = ?`,
  )
    .bind(date)
    .run();
  return c.json({ deleted: res.meta.changes ?? 0 });
}
