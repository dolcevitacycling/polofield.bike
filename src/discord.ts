import { Context } from "hono";
import hexToBuffer from "./hexToBuffer";
import { Bindings } from "./types";

/**
 * The type of interaction this request is.
 */
export enum InteractionType {
  /**
   * A ping.
   */
  PING = 1,
  /**
   * A command invocation.
   */
  APPLICATION_COMMAND = 2,
  /**
   * Usage of a message's component.
   */
  MESSAGE_COMPONENT = 3,
  /**
   * An interaction sent when an application command option is filled out.
   */
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  /**
   * An interaction sent when a modal is submitted.
   */
  MODAL_SUBMIT = 5,
}

/**
 * The type of response that is being sent.
 */
export enum InteractionResponseType {
  /**
   * Acknowledge a `PING`.
   */
  PONG = 1,
  /**
   * Respond with a message, showing the user's input.
   */
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  /**
   * Acknowledge a command without sending a message, showing the user's input. Requires follow-up.
   */
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  /**
   * Acknowledge an interaction and edit the original message that contains the component later; the user does not see a loading state.
   */
  DEFERRED_UPDATE_MESSAGE = 6,
  /**
   * Edit the message the component was attached to.
   */
  UPDATE_MESSAGE = 7,
  /*
   * Callback for an app to define the results to the user.
   */
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  /*
   * Respond with a modal.
   */
  MODAL = 9,
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
  const body = await c.req.json();
  if (failure) {
    return c.text(failure, 401);
  }
  switch (body.type) {
    case InteractionType.PING: {
      return c.json({ type: InteractionResponseType.PONG });
    }
    default: {
      console.log(JSON.stringify(body, null, 2));
      return c.text("Not Found", 404);
    }
  }
}
