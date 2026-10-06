import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banknote, CalendarDays, CalendarPlus, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { FeedbackPrompt } from "@/components/mc/feedback-prompt";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { formatPkr } from "@/lib/patient-summary";
import { firstName, pkDay, pkTime, useMyPatient, usePortalHome } from "@/lib/portal";

export const Route = createFileRoute("/_authenticated/portal/")({
  head: () => ({ meta: [
    { title: "Home — Patient portal" },
    { name: "description", content: "Your next appointment, latest reports and balance at the hospital." },
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
  const home = usePortalHome();
  if (home.isLoading) return <Skeleton className="h-60 rounded-patient" />;
  const h = home.data;
  const next = h?.next_appointment;
  return (
    <>
      {home.isError && <Banner tone="danger" title={t("portal.home.failed")} />}
      <FeedbackPrompt />
      <PCard>
        <p className="text-sm text-muted-foreground">{t("portal.record")}</p>
        <p className="text-lg font-semibold">{me.data!.full_name}</p>
        <p className="text-sm">MRN <Ltr className="font-medium">{me.data!.mrn}</Ltr></p>
      </PCard>
      <PCard>
        <p className="mb-1 flex items-center gap-2 font-medium"><CalendarDays className="size-4" aria-hidden />{t("portal.nextAppt")}</p>
        {next ? (
          <div className="space-y-0.5">
            <p className="text-lg font-semibold"><Ltr>{pkDay(next.slot_start)} · {pkTime(next.slot_start)}</Ltr></p>
            {(next.doctor_name || next.department_name) && <p className="text-sm">{[next.doctor_name, next.department_name].filter(Boolean).join(" · ")}</p>}
            {next.token_no != null && <p className="text-sm text-muted-foreground">{t("portal.token")} <Ltr>{next.token_no}</Ltr></p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("portal.noNextAppt")}</p>}
      </PCard>
      <PCard>
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-2 font-medium"><FileText className="size-4" aria-hidden />{t("portal.home.latestReports")}</p>
          <Link to="/portal/reports" className="text-sm text-primary">{t("portal.home.seeAll")}</Link>
        </div>
        {!h?.latest_reports?.length ? <p className="text-sm text-muted-foreground">{t("portal.noReports")}</p> : (
          <ul className="divide-y">
            {h.latest_reports.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 py-1.5 text-sm"><Ltr className="font-medium">{r.test_name ?? "—"}</Ltr><Ltr className="text-muted-foreground">{r.verified_at ? pkDay(r.verified_at) : ""}</Ltr></li>
            ))}
          </ul>
        )}
      </PCard>
      <Link to="/portal/bills" className="block">
        <PCard className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-medium"><Banknote className="size-4" aria-hidden />{t("portal.bills.due")}</span>
          <Ltr className={`text-lg font-semibold ${(h?.balance_due ?? 0) > 0 ? "text-warning-fg" : ""}`}>{formatPkr(h?.balance_due ?? 0)}</Ltr>
        </PCard>
      </Link>
      {h?.settings.allow_patient_booking && (
        <Button asChild size="lg" className="w-full rounded-patient"><Link to="/portal/book"><CalendarPlus aria-hidden />{t("portal.home.bookNew")}</Link></Button>
      )}
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
