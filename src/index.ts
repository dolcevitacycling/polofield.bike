import { Env, PoloFieldMessage } from "./types";

const mod: ExportedHandler<Env, PoloFieldMessage> = {
    async queue(batch, env) {
      // if (batch.queue === "slack-files") {
      //   await processSlackFilesBatch(batch, env);
      // }
    },
    async fetch(request: Request, env, ctx): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/favicon.ico" || url.pathname === "/robots.txt") {
        return new Response("", { status: 404 });
      }
      // if (url.pathname.startsWith("/slack/")) {
      //   return slackFetchHandler(url, request, env, ctx);
      // } else if (url.pathname.startsWith("/benefits/")) {
      //   return benefitsFetchHandler(url, request, env, ctx);
      // }
      return new Response("Not found", { status: 404 });
    },
  };

  export default mod;
