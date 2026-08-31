-- Migration number: 0004 	 2026-08-31T18:30:00.000Z

-- Which request shape the calendar fetch had to use.
--
-- The 2026-08-30 outage ended on the first cron run after the fallback
-- strategies shipped, and there was no way to tell from outside whether the
-- fallback did it or the origin healed itself: the only record was a
-- console.log in one workflow instance. Recording it makes the answer a GET
-- away, and makes a lasting degradation ("we have been on browser-ua for a
-- week") visible instead of silent.
ALTER TABLE scrape_health ADD COLUMN last_strategy TEXT;
-- The full attempt list of the last successful run, including the shapes that
-- failed first, with their status and cf-ray (whose suffix is the colo).
ALTER TABLE scrape_health ADD COLUMN last_attempts_json TEXT;
