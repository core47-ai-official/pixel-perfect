# MediCore HMS — Security review (F02)

Audited 7 Oct 2026 against the live Supabase project (vsfdfxlpxdxwxwaqwjku) and this repository.

| # | Item | Status | Fix made / evidence |
|---|------|--------|---------------------|
| 1a | RLS enabled on every public table (83 tables) | OK | Query of `pg_class.relrowsecurity`: 0 tables without RLS. |
| 1b | No INSERT / UPDATE / DELETE policies on public tables | OK | `pg_policies` in `public`: every policy is `SELECT`. |
| 1c | `counters` has RLS but no policy | OK | Intentional deny-all: numbering is read/written only by server functions with the service role. Supabase's "RLS enabled, no policy" notice can be ignored. |
| 1d | Storage write policy | OK | Only write policy is `tickets` "Staff upload own ticket screenshots" (INSERT into the user's own folder); all other storage writes go through server functions. |
| 2a | No Postgres functions in `public` | OK | `pg_proc` in `public`: 0 rows. |
| 2b | No triggers | OK | `pg_trigger` (non-internal) in `public`: 0 rows. |
| 2c | No `rpc()` calls | OK | `rg "\.rpc\("` over `src/` and `edge-functions/`: 0 matches. |
| 3 | No direct `supabase.from(...).insert/update/delete/upsert` in the frontend | OK | `rg` over `src/` (excluding generated files): 0 matches. All writes use `callEdgeFunction`. |
| 4a | Every user-facing function identifies the caller and checks role | OK | 154 of 174 functions use `getCaller` + role check. 14 older functions use the equivalent inline pattern (`auth.getUser(token)` + `user_roles` lookup + impersonation header). `sync-offline-queue` forwards each item to the real function with the user's own token. |
| 4b | Non-user functions are locked down | OK | Scheduled jobs (`appointment-reminders`, `installment-reminders`, `post-daily-room-charges`, `process-notifications`, `queue-notification`, `stock-alerts`, `generate-dose-events`) refuse requests without the `x-cron-key` secret. `get-tv-queue` requires the display token and returns token numbers only. |
| 4c | Filters by caller's `hospital_id` | OK | Every function reads `hospital_id` from the caller's role row, never from the request body, and scopes queries with it. |
| 4d | Audit log for changes | OK | 159 functions write `audit_logs`. Those without are cron jobs, notification housekeeping, slot/report reads that only cache or mark rows, and per-user preference writes (push subscription, notification/portal preferences, read markers). |
| 4e | Input validated with **zod** | Open — not fixed | All 174 functions validate input by hand (type, length, enum and range checks before any write), but none use zod. Converting all 174 is a large separate change; recommended to do in batches. |
| 5 | Service role key never in frontend | OK | Only reference in `src/` is `src/integrations/supabase/client.server.ts` (server-only, reads `process.env`). No `VITE_` service key; none in `public/`. |
| 6a | All storage buckets private | OK | `tickets`, `branding`, `tracker`, `credentials`: all `public = false`. |
| 6b | Files opened only through signed URLs | OK | No `getPublicUrl` anywhere. `tracker` 60 s, `tickets` 600 s, `credentials` 300 s (via `verify-doctor`). |
| 7 | Leaked-password protection (Supabase Auth) | Open — dashboard setting | Must be switched on in Supabase → Authentication → Passwords; cannot be changed from code. |
