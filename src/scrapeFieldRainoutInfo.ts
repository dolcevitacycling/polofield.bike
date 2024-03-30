import xlsx from "node-xlsx";
import fs from "fs";
import { HTMLRewriter } from "@miniflare/html-rewriter";
import { Response } from "@miniflare/core";
import { CalendarScraper, currentCalendarUrl } from "../src/scrapeCalendar";
import { Readable } from "stream";
import { ReadableStream } from "stream/web";
import { finished } from "stream/promises";

const FIELD_RAINOUT_INFO_URL =
  "https://fs18.formsite.com/res/resultsReportTable?EParam=B6fiTn%2BRcO5gxPxCLTtif%2FTBZfQjAcbzwCi9jw02kUQSq0hsyAedVkhBtIa3wGQcGW07E1SN8yI%3D";
const FIELD_RAINOUT_EXPORT_URL =
  "https://fs18.formsite.com/res/resultsReportExport?EParam=B6fiTn-RcO5gxPxCLTtif_TBZfQjAcbzwCi9jw02kUQSq0hsyAedVkhBtIa3wGQcGW07E1SN8yI";
const FIELD_RAINOUT_FILENAME = "fieldRainoutInfo.xlsx";

const downloadFieldRainoutInfo = async () => {
  /**
   * Fetch the field rainout info as an XLSX.
   *
   * This request fails if we don't set cookies in the header, so we do a base request first,
   * then sub the cookies from that response into the next request.
   */
  const baseResponse = await fetch(FIELD_RAINOUT_INFO_URL);
  const respHeaders = baseResponse.headers;
  const cookies = [...respHeaders.entries()].reduce((acc, [key, value]) => {
    if (key === "set-cookie") {
      acc.push(value);
    }

    return acc;
  }, [] as string[]);

  const stream = fs.createWriteStream(FIELD_RAINOUT_FILENAME);
  const headers = new Headers();
  headers.append("Cookie", cookies.join("; "));

  const { body } = await fetch(FIELD_RAINOUT_EXPORT_URL, { headers });

  if (!body) {
    throw Error("Unable to download field rainout info");
  }

  await finished(Readable.fromWeb(body as ReadableStream).pipe(stream));
};

export const fetchFieldRainoutInfo = async () => {
  await downloadFieldRainoutInfo();
  const workSheetsFromBuffer = xlsx.parse(
    fs.readFileSync(FIELD_RAINOUT_FILENAME),
  );
  // await fs.promises.writeFile("debug/scrape.html", fetchText);
};

// download field rainout info as xls
// const workSheetsFromBuffer = xlsx.parse(fs.readFileSync(`${__dirname}/myFile.xlsx`));
