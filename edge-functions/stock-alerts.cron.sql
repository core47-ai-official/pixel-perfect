-- Run once in Supabase → SQL Editor AFTER deploying stock-alerts.
-- Uses the same CRON_SECRET as the other daily jobs. Replace PASTE_THE_SAME_CRON_SECRET_HERE with that text.
-- Runs every day at 03:00 UTC = 08:00 Pakistan time.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'stock-alerts',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://vsfdfxlpxdxwxwaqwjku.supabase.co/functions/v1/stock-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_THE_SAME_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);
