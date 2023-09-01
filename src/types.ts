export interface Bindings {
  DB: D1Database;
  SLACK_SIGNING_SECRET: string;
  SLACK_APP_ID: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  [key: string]: unknown;
}

export interface PoloFieldMessage {}
