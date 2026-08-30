-- Migration number: 0003 	 2026-08-30T08:00:00.000Z

-- Single row tracking whether the scrape is working, so a transient upstream
-- glitch (sfrecpark.org 522s are routine and self-healing) can be told apart
-- from a sustained outage worth waking someone for.
CREATE TABLE scrape_health (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- When the calendar was last fetched and parsed successfully.
  last_success_at TEXT,
  -- Consecutive failed runs; reset to 0 on any success.
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- Start of the current run of failures, for "down since" in alerts.
  first_failure_at TEXT,
  -- When we last alerted about the current outage, so we re-alert on a slow
  -- cadence instead of every 20 minutes, and stay silent if we never did.
  last_alert_at TEXT
);

INSERT INTO scrape_health (id, consecutive_failures) VALUES (1, 0);
