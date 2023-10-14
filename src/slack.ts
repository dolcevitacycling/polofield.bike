import { Context } from "hono";
import { Bindings } from "./types";
import {
  addDays,
  clampEnd,
  clampStart,
  friendlyDate,
  friendlyTime,
  friendlyTimeSpan,
  getTodayPacific,
  parseDate,
  shortDateStyle,
} from "./dates";
import {
  cachedScrapeResult,
  intervalsForDate,
  POLO_URL,
  ScrapeResult,
} from "./cron";
import { randomCyclist, NO_BIKES, SUNRISE, SUNSET } from "./emoji";
import { getSunProps } from "./sun";
import type {
  SectionBlock,
  EnvelopedEvent,
  AppHomeOpenedEvent,
} from "@slack/bolt";
import hexToBuffer from "./hexToBuffer";

async function verifySlackSignature(c: Context<{ Bindings: Bindings }>) {
  const secret = c.env.SLACK_SIGNING_SECRET;
  const signature = /^v0=([0-9a-f]+)$/i.exec(
    c.req.header("x-slack-signature") ?? "",
  )?.[1];
  const timestamp = c.req.header("x-slack-request-timestamp");
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
    ["verify"],
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

type KnownEvents = AppHomeOpenedEvent;

async function eventCallback<Event extends KnownEvents>(
  c: Context<{ Bindings: Bindings }>,
  body: EnvelopedEvent<Event>,
) {
  switch (body.event.type) {
    case "app_home_opened": {
      await appHomeOpened(c, body.event);
      break;
    }
    default: {
      return c.text("Not Found", 404);
    }
  }
  return c.json({});
}

async function slackApiPost(
  c: { readonly env: Bindings },
  method: string,
  body: any,
) {
  return await fetch(`https://slack.com/api/${method}`, {
    body: JSON.stringify(body),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.SLACK_BOT_TOKEN}`,
    },
  });
}

async function appHomeOpened(
  c: Context<{ Bindings: Bindings }>,
  event: AppHomeOpenedEvent,
) {
  const SLACK_POLO_DAYS = 7;
  const today = parseDate(getTodayPacific());
  const { scrape_results: result } = await cachedScrapeResult(c.env);
  const blocks = Array.from({ length: SLACK_POLO_DAYS }, (_, i) =>
    sectionBlockForDay(result, addDays(today, i)),
  );
  await slackApiPost(c, "views.publish", {
    user_id: event.user,
    view: {
      type: "home",
      blocks,
    },
  });
}

export async function slackActionEndpoint(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header("content-type") !== "application/json") {
    return c.json({ error: "Invalid content-type" }, 400);
  }
  const failure = await verifySlackSignature(c);
  const body = await c.req.json();
  if (failure) {
    return c.json({ error: failure }, 401);
  }
  switch (body.type) {
    case "url_verification":
      return c.text(body.challenge);
    case "event_callback":
      return await eventCallback(c, body);
    default: {
      console.log(JSON.stringify(body, null, 2));
      return c.text("Not Found", 404);
    }
  }
}

function sectionBlockForDay(
  result: ScrapeResult,
  parsedDate: Date,
): SectionBlock {
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
}

export interface RunSlackWebhookParams {
  webhook_url: string;
  date: Date;
  params: { type: "slack:chat.postMessage" };
  scrape_results: ScrapeResult;
}

export async function runSlackWebhook(
  env: Bindings,
  { webhook_url, date, params, scrape_results }: RunSlackWebhookParams,
): Promise<void> {
  const res = await slackApiPost({ env }, "chat.postMessage", {
    blocks: [sectionBlockForDay(scrape_results, date)],
    channel: env.SLACK_CHANNEL_ID,
  });
  if (!res.ok) {
    console.error(
      "Failed to run webhook",
      webhook_url,
      res.status,
      await res.text(),
    );
    throw new Error("Failed to run webhook");
  }
}

export async function slackPolo(c: Context<{ Bindings: Bindings }>) {
  if (c.req.header("content-type") !== "application/x-www-form-urlencoded") {
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
  const today = parseDate(getTodayPacific());
  const offset =
    typeof body.text !== "string"
      ? 0
      : +(/^\s*\+?(\d+)\s*$/.exec(body.text ?? "")?.[1] ?? "0");
  const SLACK_POLO_DAYS = 3;
  const { scrape_results: result } = await cachedScrapeResult(c.env);
  const blocks = Array.from({ length: SLACK_POLO_DAYS }, (_, i) =>
    sectionBlockForDay(result, addDays(today, offset + i)),
  );
  return c.json({
    blocks,
  });
}
