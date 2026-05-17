-- Migration number: 0002 	 2026-05-17T00:00:00.000Z

CREATE TABLE scrape_patches (
  date TEXT NOT NULL PRIMARY KEY,
  expected_rule_json TEXT NOT NULL,
  patch_rule_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE daily_webhook_status ADD COLUMN last_post_date TEXT;
ALTER TABLE daily_webhook_status ADD COLUMN last_post_at TEXT;
ALTER TABLE daily_webhook_status ADD COLUMN last_post_payload_json TEXT;
ALTER TABLE daily_webhook_status ADD COLUMN last_post_response_json TEXT;

INSERT INTO scrape_patches (date, expected_rule_json, patch_rule_json, note, created_at)
VALUES (
  '2026-05-18',
  'null',
  '{"type":"known_rules","text":"2026-05-18","start_date":"2026-05-18","end_date":"2026-05-18","intervals":[{"open":true,"start_timestamp":"2026-05-18 00:00","end_timestamp":"2026-05-18 23:59"}],"rules":["[polofield.bike patch] Assumed Cycle Track Open All Day (Mondays default)"]}',
  'PF is usually open all day on Mondays; upstream calendar omitted this date',
  '2026-05-17T00:00:00.000Z'
);
