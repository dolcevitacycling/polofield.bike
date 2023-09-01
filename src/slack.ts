import { Context } from "hono";
import { Bindings } from "./types";
import {
  addDays,
  clampEnd,
  clampStart,
  friendlyDate,
  friendlyTime,
  friendlyTimeSpan,
  pacificISODate,
  parseDate,
  shortDateStyle,
} from "./dates";
import { cachedScrapeResult, intervalsForDate, POLO_URL } from "./cron";
import { randomCyclist, NO_BIKES, SUNRISE, SUNSET } from "./emoji";
import { getSunProps } from "./sun";

function hexToBuffer(hex: string) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return b;
}

async function verifySlackSignature(c: Context<{ Bindings: Bindings }>) {
  const secret = c.env.SLACK_SIGNING_SECRET;
  const signature = /^v0=([0-9a-f]+)$/i.exec(
    c.req.headers.get("x-slack-signature") ?? "",
  )?.[1];
  const timestamp = c.req.headers.get("x-slack-request-timestamp");
  console.log({ secret, signature, timestamp });
  if (!signature || !timestamp || !secret) {
    return;
  }
  if (Math.abs(Date.now() / 1000 - parseFloat(timestamp)) > 60 * 5) {
    return "Invalid timestamp";
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const data = await new Blob([
    enc.encode(`v0:${timestamp}:`),
    await c.req.raw.clone().arrayBuffer(),
  ]).arrayBuffer();
  if (
    !(await crypto.subtle.verify("HMAC", key, hexToBuffer(signature), data))
  ) {
    return "Invalid signature";
  }
}

export async function slackActionEndpoint(c: Context<{ Bindings: Bindings }>) {
  if (
    c.req.headers.get("content-type") !== "application/json"
  ) {
    return c.json({ error: "Invalid content-type" }, 400);
  }
  const failure = await verifySlackSignature(c);
  const body = await c.req.json();
  if (failure) {
    return c.json({ error: failure }, 400);
  }
  if (body.type === "url_verification") {
    return c.text(body.challenge);
  }
  return c.text("Not Found", 404);
}

export async function slackPolo(c: Context<{ Bindings: Bindings }>) {
  if (
    c.req.headers.get("content-type") !== "application/x-www-form-urlencoded"
  ) {
    return c.json({ error: "Invalid content-type" }, 400);
  }
  const failure = await verifySlackSignature(c);
  const body = await c.req.parseBody();
  if (failure) {
    return c.json({ error: failure }, 400);
  }
  if (body.ssl_check) {
    return c.json({});
  }
  const today = parseDate(pacificISODate.format(new Date()));
  const offset =
    typeof body.text !== "string"
      ? 0
      : +(/^\s*\+?(\d+)\s*$/.exec(body.text ?? "")?.[1] ?? "0");
  const SLACK_POLO_DAYS = 3;
  const { scrape_results: result } = await cachedScrapeResult(c.env);
  const blocks = Array.from({ length: SLACK_POLO_DAYS }, (_, i) => {
    const parsedDate = addDays(today, offset + i);
    const date = shortDateStyle.format(parsedDate);
    const ruleIntervals = intervalsForDate(result, date);
    if (!ruleIntervals || ruleIntervals.type !== "known") {
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${friendlyDate(
            date,
          )}*\nI don't understand these rules yet, please consult the <${POLO_URL}|Polo Field Schedule>`,
        },
      };
    }
    const { intervals } = ruleIntervals;

    const { sunrise, sunsetStart } = getSunProps(parsedDate);

    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${friendlyDate(date)}*   ${SUNRISE} ${friendlyTime(
          sunrise,
        )}  ${SUNSET} ${friendlyTime(sunsetStart)}\n${intervals
          .map((interval) => {
            const hStart = clampStart(date, interval.start_timestamp);
            const hEnd = clampEnd(date, interval.end_timestamp);
            return interval.open
              ? `${randomCyclist()} Open ${friendlyTimeSpan(hStart, hEnd)}`
              : `${NO_BIKES} Closed ${friendlyTimeSpan(hStart, hEnd)}`;
          })
          .join("\n")}`,
      },
    };
  });
  return c.json({
    blocks,
  });
}
