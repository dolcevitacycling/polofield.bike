import { it, describe, expect } from "vitest";
import {
  fetchFieldRainoutInfo,
  parseFieldRainoutInfo,
  downloadFieldRainoutInfo,
} from "./scrapeFieldRainoutInfo";

describe("downloadFieldRainoutInfo", () => {
  it(
    "should download field rainout info",
    async () => {
      await downloadFieldRainoutInfo();
    },
    {
      timeout: 10000,
    },
  );
});

describe("transformRainoutInfo", () => {
  it.each([
    {
      fieldRainoutInfo: [
        ["12/10/2022", "Sat", "All Grass Fields & Diamonds", "Closed"],
      ],
      result: true,
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
      result: true,
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
      result: false,
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
      result: false,
    },
  ])("transformRainoutInfo", ({ fieldRainoutInfo, result }) => {
    const parsed = parseFieldRainoutInfo(fieldRainoutInfo);
    expect(parsed[fieldRainoutInfo[0][0]]).toBe(result);
  });
});

describe("fetchFieldRainoutInfo", () => {
  it(
    "should fetch and parse field rainout info",
    async () => {
      const parsed = await fetchFieldRainoutInfo(20);
      expect(Object.keys(parsed).length).toBeLessThanOrEqual(20);
    },
    {
      timeout: 10000,
    },
  );
});
