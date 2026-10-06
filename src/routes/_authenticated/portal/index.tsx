import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { supabase } from "@/integrations/supabase/client";
import { firstName, pkDay, pkTime, useMyPatient } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/portal/")({
  head: () => ({ meta: [
    { title: "Home — Patient portal" },
    { name: "description", content: "Your appointments and reports at the hospital." },
  ] }),
  component: PortalHome,
});

function PortalHome() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const me = useMyPatient();
  const name = firstName(me.data?.full_name ?? context?.profile?.full_name);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("portal.hello", { name })}</h1>
      {me.isLoading ? <Skeleton className="h-40 rounded-patient" /> : me.data ? <Linked /> : <LinkRecord />}
    </div>
  );
}

function Linked() {
  const { t } = useTranslation();
  const me = useMyPatient();
  const next = useQuery({
    queryKey: ["portal", "next-appt", me.data?.id],
    enabled: !!me.data,
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("id, slot_start, token_no, status")
        .eq("patient_id", me.data!.id).gte("slot_start", new Date().toISOString()).in("status", ["booked", "checked_in"])
        .order("slot_start").limit(1).maybeSingle();
      return data as { id: string; slot_start: string; token_no: number | null } | null;
    },
  });
  return (
    <>
      <PCard>
        <p className="text-sm text-muted-foreground">{t("portal.record")}</p>
        <p className="text-lg font-semibold">{me.data!.full_name}</p>
        <p className="text-sm">MRN <Ltr className="font-medium">{me.data!.mrn}</Ltr></p>
      </PCard>
      <PCard>
        <p className="mb-1 flex items-center gap-2 font-medium"><CalendarDays className="size-4" aria-hidden />{t("portal.nextAppt")}</p>
        {next.data
          ? <p><Ltr>{pkDay(next.data.slot_start)} · {pkTime(next.data.slot_start)}</Ltr>{next.data.token_no != null && <> · {t("portal.token")} <Ltr>{next.data.token_no}</Ltr></>}</p>
          : <p className="text-sm text-muted-foreground">{t("portal.noNextAppt")}</p>}
      </PCard>
      <div className="grid grid-cols-2 gap-3">
        <Button asChild size="lg" className="rounded-patient"><Link to="/portal/book">{t("portal.nav.book")}</Link></Button>
        <Button asChild size="lg" variant="outline" className="rounded-patient"><Link to="/portal/reports"><FileText aria-hidden />{t("portal.nav.reports")}</Link></Button>
      </div>
    </>
  );
}

function LinkRecord() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mrn, setMrn] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!mrn.trim() || code.replace(/\D/g, "").length !== 6) return setError(t("portal.link.required"));
    setBusy(true);
    try { await callEdgeFunction("link-patient-record", { mrn: mrn.trim(), code }); await qc.invalidateQueries({ queryKey: ["portal"] }); }
    catch (err) { setError((err as { message?: string })?.message ?? t("portal.link.failed")); }
    finally { setBusy(false); }
  };
  return (
    <PCard>
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Link2 className="size-4" aria-hidden />{t("portal.link.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("portal.link.hint")}</p>
      {error && <div className="mb-3"><Banner tone="danger" title={error} /></div>}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5"><Label htmlFor="mrn">{t("portal.link.mrn")}</Label>
          <Input id="mrn" dir="ltr" autoCapitalize="characters" placeholder="MRN-2026-000001" className="rounded-patient" value={mrn} onChange={(e) => setMrn(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="code">{t("portal.link.code")}</Label>
          <Input id="code" dir="ltr" inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="rounded-patient text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
        <Button type="submit" size="lg" className="w-full rounded-patient" disabled={busy}>{t("portal.link.submit")}</Button>
      </form>
    </PCard>
  );
}
