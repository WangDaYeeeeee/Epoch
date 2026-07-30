-- Daily market bars and a quarterly rebalancing strategy do not benefit from
-- repeated intraday checks. Keep daily fallbacks for freshness and risk, and a
-- weekly fallback for forecast-quality backfills. Successful market refreshes
-- trigger the same calculations immediately in application code.
UPDATE scheduled_job
SET interval_seconds = 86400,
    next_run_at = LEAST(next_run_at, now() + interval '1 day'),
    updated_at = now()
WHERE id IN ('market-data-freshness-monitor', 'portfolio-risk-refresh');

UPDATE scheduled_job
SET interval_seconds = 604800,
    next_run_at = LEAST(next_run_at, now() + interval '7 days'),
    updated_at = now()
WHERE id = 'quality-metrics-refresh';
