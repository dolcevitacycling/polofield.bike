import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { nameParser, type CalendarEntry } from "./scrapeCalendar";

// Every entry from the last committed `npm run scrape` (debug/rules.json) has
// to parse. Unit tests only cover the formats someone thought to write down,
// and upstream keeps inventing new ones — "Cycle Track Until 11:00 AM",
// "Cycle Track Open Before 2:00 PM" and "Cycle Track Closed All Day Due to
// Special Event" all appeared without warning and each broke the scrape.
//
// Days that fail to parse no longer crash the scrape (they degrade to
// unknown_rules and report to Sentry/#diagnostics), so this test is what makes
// a new format loud at commit time: refresh the corpus with `npm run scrape`
// and this fails until the parser understands it.
const CORPUS = "debug/rules.json";

interface CorpusYear {
  rules: { date: string; entries: CalendarEntry[] }[];
}

describe("live scrape corpus", () => {
  const exists = fs.existsSync(CORPUS);
  it.skipIf(!exists)("parses every entry in debug/rules.json", () => {
    const years: CorpusYear[] = JSON.parse(fs.readFileSync(CORPUS, "utf-8"));
    const failures: string[] = [];
    const names = new Set<string>();
    for (const year of years) {
      for (const day of year.rules) {
        for (const entry of day.entries) {
          names.add(entry.name);
          try {
            nameParser(entry);
          } catch (err) {
            failures.push(
              `${day.date}: ${JSON.stringify(entry.name)} — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    }
    // Deduplicate: one bad format shows up on dozens of days.
    expect([
      ...new Set(failures.map((f) => f.split(": ").slice(1).join(": "))),
    ]).toEqual([]);
    // Guard against the corpus silently emptying out.
    expect(names.size).toBeGreaterThan(10);
  });
});
