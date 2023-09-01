export interface Bindings {
  DB: D1Database;
  SLACK_SIGNING_SECRET: string;
  SLACK_APP_ID: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_BOT_TOKEN: string;
  [key: string]: unknown;
}

export interface PoloFieldMessage {}
