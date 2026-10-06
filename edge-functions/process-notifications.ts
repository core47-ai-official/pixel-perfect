// Paste into Supabase → Edge Functions → new function "process-notifications". Turn "Enforce JWT Verification" OFF.
// Scheduled every minute by Supabase Cron (see process-notifications.cron.sql), header x-cron-key = CRON_SECRET.
// Sends due push notifications (scheduled_at empty or passed, not yet sent) by Web Push to every device of the user,
// up to 300 per run. Rows are claimed first (delivery_status null → sending) so overlapping runs never double-send.
// Marks sent_at (which also shows the item in the in-app bell) and delivery_status sent / no_device / failed.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:admin@hospital.pk).
// If company settings turn push off, normal items are only shown in the bell; critical items are always pushed.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page, x-cron-key",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
// deno-lint-ignore no-explicit-any
type DB = any;
const cronOk = (req: Request) => { const s = Deno.env.get("CRON_SECRET"); return !!s && req.headers.get("x-cron-key") === s; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!cronOk(req)) return fail("forbidden", "Not allowed.", 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const canPush = !!(pub && priv);
  if (canPush) webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@medicore.pk", pub!, priv!);
  const now = new Date().toISOString();
  // Give up on rows stuck in "sending" for 10 minutes (a crashed run), so they are retried.
  await db.from("notifications").update({ delivery_status: null }).eq("delivery_status", "sending").is("sent_at", null).lt("updated_at", new Date(Date.now() - 600e3).toISOString());
  const { data: due } = await db.from("notifications").select("id").is("sent_at", null).is("delivery_status", null)
    .or(`scheduled_at.is.null,scheduled_at.lte.${now}`).order("scheduled_at", { ascending: true, nullsFirst: true }).limit(300);
  const ids = (due ?? []).map((x: { id: string }) => x.id);
  if (!ids.length) return json({ ok: true, data: { sent: 0 } });
  const { data: claimed } = await db.from("notifications").update({ delivery_status: "sending", updated_at: now }).in("id", ids).is("delivery_status", null).is("sent_at", null).select("*");
  const rows = claimed ?? [];
  const users = [...new Set(rows.map((r: { user_id: string }) => r.user_id))];
  const hosp = [...new Set(rows.map((r: { hospital_id: string }) => r.hospital_id))];
  const [{ data: subs }, { data: cs }] = await Promise.all([
    db.from("push_subscriptions").select("id, user_id, endpoint, keys").in("user_id", users),
    db.from("company_settings").select("hospital_id, notifications").in("hospital_id", hosp),
  ]);
  const pushOn = (h: string) => (cs ?? []).find((x: { hospital_id: string }) => x.hospital_id === h)?.notifications?.push_enabled !== false;
  const stats = { sent: 0, no_device: 0, failed: 0, in_app: 0 };
  for (const n of rows) {
    let status = "in_app";
    if (n.channel === "push" && canPush && (n.priority === "critical" || pushOn(n.hospital_id))) {
      const mine = (subs ?? []).filter((s: { user_id: string }) => s.user_id === n.user_id);
      if (!mine.length) status = "no_device";
      else {
        let ok = 0;
        for (const s of mine) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ id: n.id, title: n.title, body: n.body, link: n.link }),
              { TTL: n.priority === "critical" ? 3600 : 86400, urgency: n.priority === "critical" ? "high" : "normal" });
            ok++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
          }
        }
        status = ok ? "sent" : "failed";
      }
    }
    stats[status as keyof typeof stats]++;
    await db.from("notifications").update({ sent_at: new Date().toISOString(), delivery_status: status, updated_at: new Date().toISOString() }).eq("id", n.id);
  }
  return json({ ok: true, data: stats });
});
