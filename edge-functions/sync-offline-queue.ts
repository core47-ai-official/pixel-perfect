// Paste into Supabase → Edge Functions → new function "sync-offline-queue". Turn "Enforce JWT Verification" OFF.
// Body: { items: [{ id (client uuid), kind: "register-patient" | "record-payment" | "record-deposit", body }] } (max 50).
// Each item is processed once: ids already done are skipped and their stored result returned.
// Items are forwarded, in order, to the real function with the caller's own sign-in, so the same
// role checks, open-shift rule and MRN / receipt numbering apply as when online.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-impersonation-session, x-page",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: { code, message } }, status);
const KINDS = ["register-patient", "record-payment", "record-deposit"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MS = 2 * 60 * 1000; // a "processing" row older than this was interrupted and may be retried

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await db.auth.getUser(auth.replace("Bearer ", ""));
  if (!u?.user) return fail("unauthorized", "Please sign in again.", 401);
  let userId = u.user.id;
  const impId = req.headers.get("x-impersonation-session");
  if (impId) {
    const { data: s } = await db.from("impersonation_sessions").select("*").eq("id", impId).maybeSingle();
    if (!s || s.super_admin_id !== userId || s.ended_at || new Date(s.expires_at) < new Date())
      return fail("forbidden", "Acting session is not active.", 403);
    userId = s.target_user_id;
  }
  const { data: prof } = await db.from("profiles").select("hospital_id, is_active").eq("id", userId).maybeSingle();
  if (!prof?.is_active) return fail("forbidden", "Account is not active.", 403);

  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const results: unknown[] = [];

  for (const it of items) {
    const id = String(it?.id ?? "");
    const kind = String(it?.kind ?? "");
    if (!UUID.test(id) || !KINDS.includes(kind)) {
      results.push({ id, status: "failed", error: { code: "validation", message: "Unknown offline item." } });
      continue;
    }
    // Claim the id. If it exists already: return the stored result, or retry only if it failed / was interrupted.
    const { error: insErr } = await db.from("offline_sync_items")
      .insert({ id, hospital_id: prof.hospital_id, user_id: userId, kind, status: "processing" });
    if (insErr) {
      if (insErr.code !== "23505") { results.push({ id, status: "failed", error: { code: "db", message: insErr.message } }); continue; }
      const { data: prev } = await db.from("offline_sync_items").select("*").eq("id", id).maybeSingle();
      if (!prev || prev.user_id !== userId) { results.push({ id, status: "failed", error: { code: "forbidden", message: "Not your item." } }); continue; }
      if (prev.status === "done") { results.push({ id, status: "done", data: prev.result, skipped: true }); continue; }
      const stale = Date.now() - new Date(prev.updated_at).getTime() > STALE_MS;
      if (prev.status === "processing" && !stale) { results.push({ id, status: "failed", error: { code: "busy", message: "Still being processed, try again shortly." } }); continue; }
      const { data: reclaimed } = await db.from("offline_sync_items")
        .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
        .eq("id", id).eq("updated_at", prev.updated_at).select("id");
      if (!reclaimed?.length) { results.push({ id, status: "failed", error: { code: "busy", message: "Still being processed, try again shortly." } }); continue; }
    }

    let out: { ok?: boolean; data?: unknown; error?: { code: string; message: string } } = {};
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: auth,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        "x-page": "offline-sync",
      };
      if (impId) headers["x-impersonation-session"] = impId;
      const r = await fetch(`${url}/functions/v1/${kind}`, { method: "POST", headers, body: JSON.stringify(it.body ?? {}) });
      out = await r.json().catch(() => ({ ok: false, error: { code: "server", message: `Server error (${r.status}).` } }));
      if (!r.ok && out.ok !== false) out = { ok: false, error: { code: "server", message: `Server error (${r.status}).` } };
    } catch (e) {
      out = { ok: false, error: { code: "network", message: (e as Error).message } };
    }

    if (out.ok === false) {
      await db.from("offline_sync_items").update({ status: "failed", error: out.error, updated_at: new Date().toISOString() }).eq("id", id);
      results.push({ id, status: "failed", error: out.error });
    } else {
      const data = out.data ?? out;
      await db.from("offline_sync_items").update({ status: "done", result: data, updated_at: new Date().toISOString() }).eq("id", id);
      results.push({ id, status: "done", data });
    }
  }
  return json({ ok: true, data: { results } });
});
