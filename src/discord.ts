import { Context } from "hono";
import hexToBuffer from "./hexToBuffer";
import { Bindings } from "./types";

async function verifyDiscordSignature(c: Context<{ Bindings: Bindings }>) {
  // https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
  // https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
  const publicKey = c.env.DISCORD_PUBLIC_KEY;
  const ALGORITHM = "Ed25519";
  const signature = /^v0=([0-9a-f]+)$/i.exec(
    c.req.headers.get("X-Signature-Ed25519") ?? "",
  )?.[1];
  const timestamp = c.req.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !publicKey) {
    return;
  }
  if (Math.abs(Date.now() / 1000 - parseFloat(timestamp)) > 60 * 5) {
    return "Invalid timestamp";
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBuffer(publicKey),
    { name: ALGORITHM, namedCurve: ALGORITHM },
    false,
    ["verify"],
  );
  const data = await new Blob([
    enc.encode(`${timestamp}:`),
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
    default: {
      console.log(JSON.stringify(body, null, 2));
      return c.text("Not Found", 404);
    }
  }
}
