-- Run once in Supabase → SQL Editor AFTER deploying generate-dose-events.
-- Uses the same CRON_SECRET as the other jobs. Replace PASTE_THE_SAME_CRON_SECRET_HERE with that text.
-- Runs every 15 minutes.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'generate-dose-events',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://vsfdfxlpxdxwxwaqwjku.supabase.co/functions/v1/generate-dose-events',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_THE_SAME_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);
