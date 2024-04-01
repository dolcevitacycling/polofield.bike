import fs from "fs";
import { HTMLRewriter } from "@miniflare/html-rewriter";
import { Response } from "@miniflare/core";
import { CalendarScraper, currentCalendarUrl } from "../src/scrapeCalendar";
import {
  downloadFieldRainoutInfo,
  downloadFieldRainoutInfoXLSX,
  fetchFieldRainoutInfo,
} from "../src/scrapeFieldRainoutInfo";

async function main() {
  const scraper = new CalendarScraper();
  const xlsx = await downloadFieldRainoutInfoXLSX();
  await fs.promises.writeFile(
    "debug/fieldRainoutInfo.xlsx",
    new DataView(xlsx),
  );
  const parsedXlsx = await downloadFieldRainoutInfo(xlsx);
  await fs.promises.writeFile(
    "debug/fieldRainoutInfo.parsed.json",
    JSON.stringify(parsedXlsx, null, 2),
  );
  scraper.fieldRainoutInfo = await fetchFieldRainoutInfo(
    undefined,
    parsedXlsx,
  );
  await fs.promises.writeFile(
    "debug/fieldRainoutInfo.result.json",
    JSON.stringify(scraper.fieldRainoutInfo, null, 2),
  );
  const fetchText = await (await fetch(currentCalendarUrl())).text();
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
}

main();
