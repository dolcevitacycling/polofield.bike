import { it, describe, expect } from "vitest";
import { toMinute } from "./dates";
import { stream, streamAtEnd } from "./parsing";
import { fetchFieldRainoutInfo } from "./scrapeFieldRainoutInfo";

describe("fetchFieldRainoutInfo", () => {
  it("should fetch field rainout info", async () => {
    await fetchFieldRainoutInfo();
  });
});
