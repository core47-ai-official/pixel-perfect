import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";

export const Route = createFileRoute("/_authenticated/_app/doctor-verification")({
  head: () => ({ meta: [
    { title: "Doctor verification — MediCore HMS" },
    { name: "description", content: "Review and verify outside doctors' PMDC registrations." },
    { property: "og:title", content: "Doctor verification — MediCore HMS" },
    { property: "og:description", content: "Approve or reject outside doctor registrations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("doctorVerification")}>
      <DoctorVerification />
    </RequireRole>
  ),
});

type Status = "pending" | "approved" | "rejected";
interface Row { id: string; user_id: string; specialty: string; clinic: string | null; pmdc_no: string | null; verification_status: Status; rejection_reason: string | null; created_at: string; name?: string | undefined; email?: string | null | undefined; phone?: string | null | undefined }

function DoctorVerification() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Status>("pending");
  const q = useQuery({
    queryKey: ["doctor-verification", tab],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, user_id, specialty, clinic, pmdc_no, verification_status, rejection_reason, created_at")
        .eq("is_outside", true).eq("verification_status", tab).order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      if (!rows.length) return rows;
      const { data: ps } = await supabase.from("profiles").select("id, full_name, email, phone").in("id", rows.map((r) => r.user_id));
      const m = new Map((ps ?? []).map((p) => [p.id, p]));
      return rows.map((r) => ({ ...r, name: m.get(r.user_id)?.full_name, email: m.get(r.user_id)?.email, phone: m.get(r.user_id)?.phone }));
    },
  });
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">{t("dver.title")}</h1><p className="text-sm text-muted-foreground">{t("dver.intro")}</p></div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <TabsList>{(["pending", "approved", "rejected"] as Status[]).map((s) => <TabsTrigger key={s} value={s}>{t(`dver.${s}`)}</TabsTrigger>)}</TabsList>
      </Tabs>
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? <p className="text-sm text-muted-foreground">{t("dver.none")}</p> : (
        <div className="grid gap-3 md:grid-cols-2">{q.data.map((r) => <DoctorCard key={r.id} r={r} />)}</div>
      )}
    </div>
  );
}

function DoctorCard({ r }: { r: Row }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async () => {
    try { const d = await callEdgeFunction<{ url: string }>("verify-doctor", { doctor_id: r.id, action: "certificate" }); window.open(d.url, "_blank", "noopener"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try { await callEdgeFunction("verify-doctor", { doctor_id: r.id, action, reason }); toast.success(t("dver.done")); await qc.invalidateQueries({ queryKey: ["doctor-verification"] }); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div><p className="font-semibold">{r.name ?? "—"}</p><p className="text-muted-foreground">{r.specialty} · {r.clinic}</p></div>
        <p>PMDC: <Ltr className="font-mono">{r.pmdc_no}</Ltr></p>
        <p className="text-muted-foreground"><Ltr>{r.email}</Ltr> · <Ltr>{r.phone}</Ltr></p>
        {r.rejection_reason && <p className="text-destructive">{r.rejection_reason}</p>}
        <Button size="sm" variant="outline" onClick={open}>{t("dver.view")}</Button>
        {r.verification_status === "pending" && (
          <div className="space-y-2 border-t pt-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("dver.reason")} aria-label={t("dver.reason")} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => decide("approve")}>{t("dver.approve")}</Button>
              <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => decide("reject")}>{t("dver.reject")}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
