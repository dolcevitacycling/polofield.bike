import { it, describe, expect } from "vitest";
import * as fs from "fs";
import {
  fetchFieldRainoutInfo,
  parseFieldRainoutInfo,
  downloadFieldRainoutInfo,
  isTrackOpen,
} from "./scrapeFieldRainoutInfo";

describe("downloadFieldRainoutInfo", () => {
  it.skipIf(!process.env.TEST_NETWORK)(
    "should download field rainout info",
    async () => {
      await downloadFieldRainoutInfo();
    },
    {
      timeout: 10000,
    },
  );
});

const HEADER = [
  "Date:",
  "Day",
  "Field/Complex",
  "Field Is:",
  "Additional Information:",
];

describe("transformRainoutInfo", () => {
  it.each([
    {
      fieldRainoutInfo: [
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Open",
          "OPEN fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nGrattan\nHamilton\nMcCoppin\nMoscone D4\nPolo\nVisitation Valley\nWest Sunset",
        ],
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Closed",
          "CLOSED fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nBalboa (ALL)\nChristopher\nGlen Park\nLarsen\nLouis Sutter\nMoscone D1/D2/D3\nParkside\nPresidio Wall\nRolph\nSunset Rec",
        ],
      ],
      result: { "2024-03-31": false },
    },
    // This one is hypothetical but requires information from an older row to determine the status correctly
    {
      fieldRainoutInfo: [
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Open",
          "OPEN fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nGrattan\nHamilton\nMcCoppin\nMoscone D4\nVisitation Valley\nWest Sunset",
        ],
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Closed",
          "CLOSED fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nBalboa (ALL)\nChristopher\nGlen Park\nLarsen\nLouis Sutter\nMoscone D1/D2/D3\nParkside\nPolo\nPresidio Wall\nRolph\nSunset Rec",
        ],
      ],
      result: { "2024-03-31": true },
    },
    // Check that it also works in the other order
    {
      fieldRainoutInfo: [
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Closed",
          "CLOSED fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nBalboa (ALL)\nChristopher\nGlen Park\nLarsen\nLouis Sutter\nMoscone D1/D2/D3\nParkside\nPolo\nPresidio Wall\nRolph\nSunset Rec",
        ],
        [
          "03/31/2024",
          "Sun",
          "Other See Below",
          "Open",
          "OPEN fields are listed below. Note: If a field is not listed on either the closed or open lists, please use your judgment and avoid areas with puddles, mud, etc.\n\nGrattan\nHamilton\nMcCoppin\nMoscone D4\nVisitation Valley\nWest Sunset",
        ],
      ],
      result: { "2024-03-31": true },
    },
    {
      fieldRainoutInfo: [
        ["12/10/2022", "Sat", "All Grass Fields & Diamonds", "Closed"],
      ],
      result: { "2022-12-10": true },
    },
    {
      fieldRainoutInfo: [
        [
          "04/07/2023",
          "Fri",
          "Other See Below",
          "Closed",
          "Marina Green\n" +
            "Moscone\n" +
            "Presidio Wall\n" +
            "Grattan\n" +
            "Big Rec\n" +
            "Little Rec\n" +
            "Polo\n" +
            "St Mary's Rec D2\n" +
            "West Sunset Baseball\n" +
            "Balboa Sunberg & Sweeney\n" +
            "\n" +
            "\n" +
            "Still waiting on a few more. Please check back soon.",
        ],
      ],
      result: { "2023-04-07": true },
    },
    {
      fieldRainoutInfo: [
        [
          "03/23/2023",
          "Thur",
          "Other See Below",
          "Open",
          "Polo\n" +
            "West Sunset Soccer\n" +
            "West Sunset D1, D2, D3\n" +
            "Moscone D2, D4\n" +
            "Marina Green\n" +
            "Rossi D1\n" +
            "St. Mary's D1\n" +
            "Little Rec\n" +
            "McCoppin\n" +
            "Parkside\n" +
            "Upper Noe\n" +
            "Eureka Valley\n" +
            "Crocker D1, D2, D3, D5",
        ],
      ],
      result: { "2023-03-23": false },
    },
    {
      fieldRainoutInfo: [
        [
          "04/05/2019",
          "Fri",
          "All Fields Except (see next)",
          "Closed",
          "All fields NOT listed are closed. \n" +
            "\n" +
            "The following fields are OPEN:\n" +
            "Silver Terrace\n" +
            "VMD\n" +
            "West Sunset Soccer\n" +
            "Parkside\n" +
            "Soccer practices at Rossi \n" +
            "McCoppin\n" +
            "Gilman\n" +
            "Palega\n" +
            "Polo\n" +
            "Little Rec\n",
        ],
      ],
      result: { "2019-04-05": false },
    },
  ])("transformRainoutInfo", ({ fieldRainoutInfo, result }) => {
    const parsed = parseFieldRainoutInfo([HEADER, ...fieldRainoutInfo]);
    const res = Object.entries(result)[0];

    expect(isTrackOpen(parsed[res[0]])).toBe(res[1]);
  });
});

describe("fetchFieldRainoutInfo", () => {
  it.skipIf(!process.env.TEST_NETWORK)(
    "should fetch and parse field rainout info",
    async () => {
      const year = 2024;
      const jan1 = `${year}-01-01`;
      const parsed = await fetchFieldRainoutInfo(year);
      expect(Object.keys(parsed).every((k) => k >= jan1)).toBe(true);
    },
    {
      timeout: 10000,
    },
  );
  it("should fetch and parse field rainout info from ./debug/fieldRainoutInfo.xlsx", async () => {
    const year = 2024;
    const jan1 = `${year}-01-01`;
    const worksheets = await downloadFieldRainoutInfo(
      fs.readFileSync("./debug/fieldRainoutInfo.xlsx"),
    );
    const parsed = await fetchFieldRainoutInfo(year, worksheets);
    expect(Object.keys(parsed).every((k) => k >= jan1)).toBe(true);
  });
});
