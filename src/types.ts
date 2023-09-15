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
  DISCORD_TEST_GUILD_ID: string;
  DISCORD_TOKEN: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_DIAGNOSTICS_WEBHOOK_URL?: string;
  [key: string]: unknown;
}

export interface PoloFieldMessage {}
