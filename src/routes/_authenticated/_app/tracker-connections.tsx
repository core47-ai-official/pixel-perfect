import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { PERM_KEYS, useConnections, type Connection } from "@/lib/connections";

export const Route = createFileRoute("/_authenticated/_app/tracker-connections")({
  head: () => ({ meta: [
    { title: "Tracker connections — MediCore HMS" },
    { name: "description", content: "Patients who share their health tracker with you." },
    { property: "og:title", content: "Tracker connections — MediCore HMS" },
    { property: "og:description", content: "Connection requests and shared patient readings." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("trackerConnections")}>
      <TrackerConnections />
    </RequireRole>
  ),
});

const pkDT = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function TrackerConnections() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const conns = useConnections("doctor");
  const [busy, setBusy] = useState<string | null>(null);
  const code = useQuery({ queryKey: ["my-doctor-code"], queryFn: () => callEdgeFunction<{ doctor_code: string }>("respond-connection", { action: "my_code" }) });

  const respond = async (c: Connection, action: "accept" | "decline") => {
    setBusy(c.id);
    try { await callEdgeFunction("respond-connection", { connection_id: c.id, action }); toast.success(t(action === "accept" ? "conn.accepted" : "conn.declined")); await qc.invalidateQueries({ queryKey: ["connections", "doctor"] }); }
    catch (e) { toast.error((e as Error).message || t("conn.failed")); }
    finally { setBusy(null); }
  };
  const requests = (conns.data ?? []).filter((c) => c.status === "requested");
  const active = (conns.data ?? []).filter((c) => c.status === "active");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t("conn.docTitle")}</h1><p className="text-sm text-muted-foreground">{t("conn.docIntro")}</p></div>
        <div className="rounded-md border px-3 py-2 text-sm">{t("conn.myCode")}: <Ltr className="font-mono text-lg font-semibold tracking-widest">{code.data?.doctor_code ?? "……"}</Ltr></div>
      </div>
      {conns.isLoading ? <Skeleton className="h-40" /> : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">{t("conn.requests")} ({requests.length})</CardTitle></CardHeader>
            <CardContent>
              {!requests.length ? <p className="text-sm text-muted-foreground">{t("conn.noRequests")}</p> : (
                <ul className="divide-y">{requests.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div><p className="font-medium">{c.patient_name ?? "—"}</p><Ltr className="text-xs text-muted-foreground">{pkDT(c.created_at)}</Ltr></div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy === c.id} onClick={() => respond(c, "accept")}>{t("conn.accept")}</Button>
                      <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => respond(c, "decline")}>{t("conn.decline")}</Button>
                    </div>
                  </li>
                ))}</ul>
              )}
            </CardContent>
          </Card>
          <h2 className="text-lg font-semibold">{t("conn.activeList")} ({active.length})</h2>
          {!active.length ? <p className="text-sm text-muted-foreground">{t("conn.noActive")}</p> : (
            <div className="grid gap-4 md:grid-cols-2">{active.map((c) => <ActiveCard key={c.id} c={c} />)}</div>
          )}
        </>
      )}
    </div>
  );
}

function ActiveCard({ c }: { c: Connection }) {
  const { t } = useTranslation();
  const shared = c.permissions?.measurements !== false;
  // Reads go through RLS, which checks the live connection row — turning sharing off empties this at once.
  const readings = useQuery({
    queryKey: ["conn-readings", c.id, JSON.stringify(c.permissions)],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from("measurements").select("id, type, value_1, value_2, unit, measured_at")
        .eq("patient_account_id", c.patient_account_id).order("measured_at", { ascending: false }).limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card data-testid="conn-readings">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{c.patient_name ?? "—"}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("conn.sharing")}: {PERM_KEYS.filter((k) => c.permissions?.[k] !== false).map((k) => t(`conn.perm_${k}`)).join(", ") || "—"}</p>
      </CardHeader>
      <CardContent>
        <p className="mb-1 text-sm font-medium">{t("conn.readings")}</p>
        {readings.isLoading ? <Skeleton className="h-16" /> : !readings.data?.length ? (
          <p className="text-sm text-muted-foreground">{shared ? t("conn.noReadings") : t("conn.notShared")}</p>
        ) : (
          <ul className="divide-y text-sm">{readings.data.map((m) => (
            <li key={m.id} className="flex justify-between py-1">
              <span>{t(`meas.t.${m.type}`, { defaultValue: m.type })}</span>
              <Ltr>{m.value_1}{m.value_2 != null ? `/${m.value_2}` : ""} {m.unit ?? ""} · {pkDT(m.measured_at)}</Ltr>
            </li>
          ))}</ul>
        )}
      </CardContent>
    </Card>
  );
}
