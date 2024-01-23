import fs from "fs";
import { ScheduleScraper, POLO_URL, RECOGNIZERS, Recognizer, KnownRules } from "../src/cron";
import { HTMLRewriter } from "@miniflare/html-rewriter";
import { Response } from "@miniflare/core";

function regexpEscape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const scraper = new ScheduleScraper();
  const fetchText = await (await fetch(POLO_URL)).text();
  await fs.promises.writeFile("debug/scrape.html", fetchText);
  const res = new HTMLRewriter()
    .on("*", scraper)
    .transform(new Response(fetchText));
  await res.text();
  await fs.promises.writeFile(
    "debug/rules.json",
    JSON.stringify(scraper.years, null, 2),
  );
  const result = scraper.getDebugResult();
  await fs.promises.writeFile(
    "debug/result.json",
    JSON.stringify(
      result.map((y) => ({
        ...y,
        rules: y.rules.map((r) => ({ ...r, recognizer: r.recognizer?.name })),
      })),
      null,
      2,
    ),
  );
  const coverage = new Map<Recognizer, KnownRules[]>();
  for (const year of result) {
    for (const { recognizer, rules: rule } of year.rules) {
      if (recognizer) {
        const recognizerCoverage = coverage.get(recognizer) || [];
        recognizerCoverage.push(rule);
        coverage.set(recognizer, recognizerCoverage);
      }
      if (rule.type === "unknown_rules") {
        console.log(`UNKNOWN: ${rule.start_date} - ${rule.end_date}
${rule.text}
--
${rule.rules.join("\n")}\n`);
        console.log(`\n/^${regexpEscape(rule.rules.join(" "))}$/i`);
      }
    }
  }
  console.log(`\nRule Coverage: ${coverage.size}/${RECOGNIZERS.length}`);
  const names = new Map<string, number>();
  RECOGNIZERS.forEach((r, i) => {
    const rules = coverage.get(r);
    if (!rules) {
      console.log(`❌ ${i} ${r.name} - NO COVERAGE`);
    } else {
      console.log(`✅ ${i} ${r.name}`);
      for (const rule of rules) {
        console.log(`  ${rule.start_date} - ${rule.end_date}`);
      }
    }
    if (names.has(r.name)) {
      console.log(
        `❌ ${i} ${r.name} - DUPLICATE NAME of rule ${names.get(r.name)}`,
      );
    }
    names.set(r.name, i);
  });
}

main();
