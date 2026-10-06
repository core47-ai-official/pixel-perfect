-- Run once in Supabase → SQL Editor AFTER deploying process-notifications.
-- Uses the same CRON_SECRET as the other jobs. Replace PASTE_THE_SAME_CRON_SECRET_HERE with that text.
-- Runs every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'process-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://vsfdfxlpxdxwxwaqwjku.supabase.co/functions/v1/process-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_THE_SAME_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);
