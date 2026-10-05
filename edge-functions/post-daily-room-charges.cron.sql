-- Run once in Supabase → SQL Editor AFTER deploying post-daily-room-charges
-- and adding the Edge Function secret CRON_SECRET (any long random text).
-- Replace PASTE_THE_SAME_CRON_SECRET_HERE with that same text.
-- Runs every day at 19:05 UTC = 00:05 Pakistan time.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'post-daily-room-charges',
  '5 19 * * *',
  $$
  select net.http_post(
    url := 'https://vsfdfxlpxdxwxwaqwjku.supabase.co/functions/v1/post-daily-room-charges',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_THE_SAME_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);
