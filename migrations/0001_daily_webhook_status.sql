-- Migration number: 0001 	 2023-09-08T00:20:35.973Z
CREATE TABLE daily_webhook_status(
  webhook_url TEXT NOT NULL PRIMARY KEY,
  last_update_utc TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}'
);
