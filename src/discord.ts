import { Context } from "hono";
import hexToBuffer from "./hexToBuffer";
import { Bindings } from "./types";
import {
  Routes,
  RouteBases,
  InteractionType,
  InteractionResponseType,
  APIInteraction,
  APIInteractionResponsePong,
  APIApplicationCommandIntegerOption,
  APIApplicationCommandInteraction,
  APIInteractionResponseChannelMessageWithSource,
  MessageFlags,
  RESTPostAPIWebhookWithTokenJSONBody,
} from "discord-api-types/v10";
import {
  POLO_URL,
  ScrapeResult,
  cachedScrapeResult,
  intervalsForDate,
} from "./cron";
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
import { SUNRISE, SUNSET, randomCyclist, NO_BIKES } from "./emoji";
import { getSunProps } from "./sun";

export const COMMANDS = [
  {
    name: "polo",
    description: "Get the current Polo Field cycle track schedule",
  },
] as const;

async function discordApiFetch(
  c: Context<{ Bindings: Bindings }>,
  path: string,
  method: "PUT" | "POST" | "PATCH",
  body: any,
) {
  return await fetch(`${RouteBases.api}${path}`, {
    body: JSON.stringify(body),
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${c.env.DISCORD_TOKEN}`,
    },
  });
}

export async function discordReport(
  env: Bindings,
  content: string,
  webhook_name = "DISCORD_DIAGNOSTICS_WEBHOOK_URL",
): Promise<void> {
  const url = env[webhook_name];
  if (typeof url !== "string" || !url) {
    return;
  }
  await fetch(url, {
    body: JSON.stringify({
      content,
    } satisfies RESTPostAPIWebhookWithTokenJSONBody),
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function discordRegisterCommands(
  c: Context<{ Bindings: Bindings }>,
) {
  const res = await discordApiFetch(
    c,
    Routes.applicationCommands(c.env.DISCORD_CLIENT_ID),
    "PUT",
    COMMANDS,
  );
  return c.text(
    await res.text(),
    res.status,
    Object.fromEntries(res.headers.entries()),
  );
}

export interface RunDiscordWebhookParams {
  webhook_url: string;
  date: Date;
  params: { type: "discord" };
  scrape_results: ScrapeResult;
}
export async function runDiscordWebhook(
  env: Bindings,
  { webhook_url, date, params, scrape_results }: RunDiscordWebhookParams,
) {
  const res = await fetch(webhook_url, {
    method: "POST",
    body: JSON.stringify({
      content: poloLineForDay(scrape_results, date),
      flags: MessageFlags.SuppressNotifications,
    } satisfies RESTPostAPIWebhookWithTokenJSONBody),
    headers: { "Content-Type": "application/json" },
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

export function poloLineForDay(result: ScrapeResult, parsedDate: Date): string {
  const date = shortDateStyle.format(parsedDate);
  const ruleIntervals = intervalsForDate(result, date);
  if (!ruleIntervals || ruleIntervals.type !== "known") {
    return `**${friendlyDate(
      date,
    )}**\nI don't understand these rules yet, please consult the [${POLO_URL}](Polo Field Schedule)`;
  }
  const { intervals } = ruleIntervals;
  const { sunrise, sunsetStart } = getSunProps(parsedDate);
  return `**${friendlyDate(date)}**   ${SUNRISE} ${friendlyTime(
    sunrise,
  )}  ${SUNSET} ${friendlyTime(sunsetStart)}\n${intervals
    .map((interval) => {
      const hStart = clampStart(date, interval.start_timestamp);
      const hEnd = clampEnd(date, interval.end_timestamp);
      return interval.open
        ? `${randomCyclist()} Open ${friendlyTimeSpan(hStart, hEnd)}`
        : `${NO_BIKES} Closed ${friendlyTimeSpan(hStart, hEnd)}`;
    })
    .join("\n")}`;
}

export async function discordCommand(
  c: Context<{ Bindings: Bindings }>,
  body: APIApplicationCommandInteraction,
) {
  if (body.data.name === "polo") {
    const POLO_DAYS = 3;
    const today = parseDate(getTodayPacific());
    const { scrape_results: result } = await cachedScrapeResult(c.env);
    const lines = Array.from({ length: POLO_DAYS }, (_, i) =>
      poloLineForDay(result, addDays(today, i)),
    );

    const res: APIInteractionResponseChannelMessageWithSource = {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: lines.join("\n"),
        flags: MessageFlags.SuppressNotifications,
      },
    };
    return c.json(res);
  }
  console.log(JSON.stringify(body, null, 2));
  return c.json({ error: "Unknown command" }, 400);
}

async function verifyDiscordSignature(c: Context<{ Bindings: Bindings }>) {
  // https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
  // https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
  const publicKey = c.env.DISCORD_PUBLIC_KEY;
  const ALGORITHM = "Ed25519";
  const signature = c.req.headers.get("X-Signature-Ed25519");
  const timestamp = c.req.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !publicKey) {
    return;
  }
  if (Math.abs(Date.now() / 1000 - parseFloat(timestamp)) > 60 * 5) {
    return "Invalid timestamp";
  }
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBuffer(publicKey),
    { name: ALGORITHM, namedCurve: ALGORITHM },
    false,
    ["verify"],
  );
  const data = await new Blob([
    new TextEncoder().encode(timestamp),
    await c.req.raw.clone().arrayBuffer(),
  ]).arrayBuffer();
  if (
    !(await crypto.subtle.verify(ALGORITHM, key, hexToBuffer(signature), data))
  ) {
    return "Invalid signature";
  }
}

export async function discordInteractions(c: Context<{ Bindings: Bindings }>) {
  if (c.req.headers.get("content-type") !== "application/json") {
    return c.json({ error: "Invalid content-type" }, 400);
  }
  const failure = await verifyDiscordSignature(c);
  const body: APIInteraction = await c.req.json();
  if (failure) {
    return c.text(failure, 401);
  }
  switch (body.type) {
    case InteractionType.Ping: {
      return c.json({
        type: InteractionResponseType.Pong,
      } satisfies APIInteractionResponsePong);
    }
    case InteractionType.ApplicationCommand: {
      return await discordCommand(c, body);
    }
    default: {
      console.log(JSON.stringify(body, null, 2));
      return c.text("Not Found", 404);
    }
  }
}
