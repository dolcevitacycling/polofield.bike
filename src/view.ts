import { Context } from "hono";
import { Bindings } from "./types";
import { intervalsForDate, scrapePoloURL } from "./cron";

export default async function view(c: Context<{ Bindings: Bindings }>, date: string) {
  const result = await scrapePoloURL();
  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals) {
    return c.notFound();
  }
  return c.text(JSON.stringify({ date, ...ruleIntervals }, null, 2), 200, {
    "Content-Type": "application/json",
  });
}
