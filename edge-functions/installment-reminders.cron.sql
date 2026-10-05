-- Run once in Supabase → SQL Editor AFTER deploying installment-reminders.
-- Uses the same CRON_SECRET you already added for post-daily-room-charges.
-- Replace PASTE_THE_SAME_CRON_SECRET_HERE with that same text.
-- Runs every day at 04:00 UTC = 09:00 Pakistan time.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'installment-reminders',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://vsfdfxlpxdxwxwaqwjku.supabase.co/functions/v1/installment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_THE_SAME_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);
