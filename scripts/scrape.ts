import fs from "fs";
import { ScheduleScraper, POLO_URL } from "../src/cron";
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
  const result = scraper.getResult();
  await fs.promises.writeFile(
    "debug/result.json",
    JSON.stringify(result, null, 2),
  );
  for (const year of result) {
    for (const rule of year.rules) {
      if (rule.type === "unknown_rules") {
        console.log(`UNKNOWN: ${rule.start_date} - ${rule.end_date}
${rule.text}
--
${rule.rules.join("\n")}\n`);
        console.log(`\n/^${regexpEscape(rule.rules.join(" "))}$/i`);
      }
    }
  }
}

main();
