import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Clock, Plus, Scale, Stethoscope } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { EmptyState } from "@/components/mc/empty-state";
import { ErRegisterPanel } from "@/components/mc/er-register-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { byLabel, useBeds, useWards, WARD_TYPES } from "@/lib/beds";
import { cn } from "@/lib/utils";
import {
  DISPOSITIONS, ER_INVALIDATE, TRIAGE_BG, TRIAGE_COLORS, TRIAGE_TONE, triageRank, useOpenEmergencyCases, waitInfo,
  type EmergencyCase, type MlcDetails, type TriageColor,
} from "@/lib/emergency";

export const Route = createFileRoute("/_authenticated/_app/emergency")({
  head: () => ({ meta: [{ title: "Emergency board — MediCore HMS" }, { name: "description", content: "Live emergency board with triage, bays and waiting times." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("emergency")}>
      <ErBoard />
    </RequireRole>
  ),
});

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return now;
}

function ErBoard() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canRegister = ["super_admin", "admin", "er_officer", "receptionist"].some(hasRole);
  const cases = useOpenEmergencyCases();
  const wards = useWards();
  const beds = useBeds();
  const now = useNow();
  const [regOpen, setRegOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const erWardIds = useMemo(() => new Set((wards.data ?? []).filter((w) => w.type === "er" && w.is_active).map((w) => w.id)), [wards.data]);
  const bays = useMemo(() => (beds.data ?? []).filter((b) => erWardIds.has(b.ward_id)).sort(byLabel), [beds.data, erWardIds]);
  const list = cases.data ?? [];
  const byBay = new Map(list.filter((c) => c.bay_bed_id).map((c) => [c.bay_bed_id!, c]));
  const waiting = list.filter((c) => !c.bay_bed_id).sort((a, b) => {
    const r = (triageRank(a) === -1 ? -0.5 : triageRank(a)) - (triageRank(b) === -1 ? -0.5 : triageRank(b));
    return r || a.arrived_at.localeCompare(b.arrived_at);
  });
  const counts = TRIAGE_COLORS.map((c) => [c, list.filter((x) => x.triage_color === c).length] as const);
  const untriaged = list.filter((x) => !x.triage_color).length;
  const current = list.find((c) => c.id === selected) ?? null;

  if (cases.isLoading || beds.isLoading) return <div className="space-y-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {counts.map(([c, n]) => (
          <div key={c} className={cn("flex min-w-24 flex-col rounded-lg px-4 py-2", TRIAGE_BG[c])}>
            <span className="text-xs font-medium">{t(`er.colors.${c}`)}</span><Ltr className="text-2xl font-bold">{n}</Ltr>
          </div>
        ))}
        <div className="flex min-w-24 flex-col rounded-lg border px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">{t("er.untriaged")}</span><Ltr className="text-2xl font-bold">{untriaged}</Ltr>
        </div>
        <div className="ms-auto">{canRegister && <Button onClick={() => setRegOpen(true)}><Plus />{t("quick.newEmergency")}</Button>}</div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("er.waitingNoBay")} · <Ltr>{waiting.length}</Ltr></h2>
        {waiting.length === 0 ? <p className="text-sm text-muted-foreground">{t("er.noneWaiting")}</p> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {waiting.map((c) => <CaseCard key={c.id} c={c} now={now} onClick={() => setSelected(c.id)} />)}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("er.bays")}</h2>
        {bays.length === 0 ? <EmptyState title={t("er.noBays")} description={t("er.noBaysHint")} /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {bays.map((b) => {
              const c = byBay.get(b.id);
              return c ? (
                <div key={b.id} className="space-y-1">
                  <Ltr className="font-mono text-xs font-semibold text-muted-foreground">{b.label}</Ltr>
                  <CaseCard c={c} now={now} onClick={() => setSelected(c.id)} compact />
                </div>
              ) : (
                <div key={b.id} className="space-y-1">
                  <Ltr className="font-mono text-xs font-semibold text-muted-foreground">{b.label}</Ltr>
                  <div className="flex h-[88px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">{t(`wd.statuses.${b.status}`, b.status)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ErRegisterPanel open={regOpen} onOpenChange={setRegOpen} />
      {current && <CasePanel c={current} bays={bays.filter((b) => b.status === "free" || b.id === current.bay_bed_id)} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CaseCard({ c, now, onClick, compact }: { c: EmergencyCase; now: number; onClick: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const w = waitInfo(c, now);
  return (
    <button onClick={onClick} className={cn("w-full rounded-lg border bg-card p-3 text-start shadow-sm transition hover:bg-accent", w.overdue && "border-urgent ring-1 ring-urgent")}>
      <div className="flex items-center gap-2">
        <span className={cn("size-3 shrink-0 rounded-full", c.triage_color ? TRIAGE_BG[c.triage_color] : "border-2 border-dashed border-muted-foreground")} aria-hidden />
        <span className="truncate font-medium">{c.patients?.full_name}</span>
        {c.mlc && <Scale className="size-4 shrink-0 text-urgent" aria-label={t("er.mlc")} />}
      </div>
      {!compact && <p className="mt-1 truncate text-sm text-muted-foreground">{c.complaint}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1 font-medium", w.overdue ? "text-urgent" : "text-muted-foreground")}>
          <Clock className="size-3.5" /><Ltr>{w.minutes}</Ltr> {t("er.min")}
        </span>
        {c.seen_at ? <StatusChip status="ok">{t("er.seen")}</StatusChip>
          : c.triage_color ? <StatusChip status={TRIAGE_TONE[c.triage_color]}>{t(`er.colors.${c.triage_color}`)}</StatusChip>
          : <StatusChip status="inactive">{t("er.untriaged")}</StatusChip>}
      </div>
    </button>
  );
}

function CasePanel({ c, bays, onClose }: { c: EmergencyCase; bays: { id: string; label: string }[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const any = (r: string[]) => r.some(hasRole);
  const canClinical = any(["super_admin", "admin", "er_officer", "nurse", "doctor", "dept_head"]);
  const canDecide = any(["super_admin", "admin", "er_officer", "doctor", "dept_head"]);
  const triage = useEdgeFunction("set-triage", { invalidate: ER_INVALIDATE });
  const bay = useEdgeFunction("assign-er-bed", { invalidate: ER_INVALIDATE, successMessage: t("er.bayAssigned") });
  const seen = useEdgeFunction("mark-seen", { invalidate: ER_INVALIDATE, successMessage: t("er.markedSeen") });
  const [mlcOpen, setMlcOpen] = useState(false);
  const [dispOpen, setDispOpen] = useState(false);
  const run = (p: Promise<unknown>) => p.catch(() => undefined);

  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={c.patients?.full_name ?? ""} description={c.complaint}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 text-sm">
          <Ltr className="font-mono">{c.patients?.mrn}</Ltr>
          {c.patients?.is_unknown && <StatusChip status="warning">{t("er.unknownPatient")}</StatusChip>}
          {(c.patients?.allergies ?? []).map((a) => <StatusChip key={a} status="urgent">{a}</StatusChip>)}
        </div>
        <p className="text-sm text-muted-foreground">{t("er.arrivedAt")} <Ltr>{new Date(c.arrived_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}</Ltr> · {t(`er.modes.${c.arrival_mode}`, c.arrival_mode)}</p>

        {canClinical && (
          <div className="space-y-1.5"><Label>{t("er.triage")}</Label>
            <div className="grid grid-cols-4 gap-2">
              {TRIAGE_COLORS.map((col) => (
                <button key={col} disabled={triage.isPending} onClick={() => run(triage.mutateAsync({ case_id: c.id, triage_color: col }))}
                  className={cn("h-11 rounded-md text-sm font-semibold ring-offset-2 ring-offset-background", TRIAGE_BG[col], c.triage_color === col ? "ring-2 ring-ring" : "opacity-50")}>
                  {t(`er.colors.${col}`)}
                </button>
              ))}
            </div></div>
        )}

        {canClinical && (
          <div className="space-y-1.5"><Label>{t("er.bay")}</Label>
            <Select value={c.bay_bed_id ?? "none"} onValueChange={(v) => run(bay.mutateAsync({ case_id: c.id, bed_id: v === "none" ? null : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("er.noBay")}</SelectItem>
                {bays.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select></div>
        )}

        <div className="rounded-md border p-3 text-sm">
          {c.seen_at ? <p><Stethoscope className="me-1 inline size-4" />{t("er.seenBy", { name: c.seen_by_name ?? "" })} <Ltr>{new Date(c.seen_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}</Ltr></p>
            : canDecide ? <Button className="w-full" disabled={seen.isPending} onClick={() => run(seen.mutateAsync({ case_id: c.id }))}><Stethoscope />{t("er.markSeen")}</Button>
            : <p className="text-muted-foreground">{t("er.notSeen")}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {canDecide && <Button variant={c.mlc ? "destructive" : "outline"} onClick={() => setMlcOpen(true)}><Scale />{c.mlc ? t("er.mlcEdit") : t("er.mlcMark")}</Button>}
          {canDecide && <Button onClick={() => setDispOpen(true)}>{t("er.disposition")}</Button>}
          <Button variant="ghost" asChild><Link to="/patients/$patientId" params={{ patientId: c.patient_id }}>{t("er.openProfile")}</Link></Button>
        </div>
      </div>
      {mlcOpen && <MlcPanel c={c} onClose={() => setMlcOpen(false)} />}
      {dispOpen && <DispositionPanel c={c} onClose={() => { setDispOpen(false); }} onDone={onClose} />}
    </SidePanel>
  );
}

function MlcPanel({ c, onClose }: { c: EmergencyCase; onClose: () => void }) {
  const { t } = useTranslation();
  const [mlc, setMlc] = useState(c.mlc || true);
  const [d, setD] = useState<MlcDetails>(c.mlc_details ?? {});
  const save = useEdgeFunction("set-mlc", { invalidate: ER_INVALIDATE, successMessage: t("er.mlcSaved") });
  const f = (k: keyof MlcDetails, req = false, ltr = false) => (
    <div className="space-y-1.5"><Label htmlFor={`mlc-${k}`}>{t(`er.mlcFields.${k}`)}{req && mlc ? " *" : ""}</Label>
      {k === "injury_summary"
        ? <Textarea id={`mlc-${k}`} rows={3} value={d[k] ?? ""} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        : <Input id={`mlc-${k}`} dir={ltr ? "ltr" : undefined} value={d[k] ?? ""} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
    </div>
  );
  const submit = async () => {
    if (mlc && (!d.fir_no?.trim() || !d.police_station?.trim() || !d.officer_name?.trim())) { toast.error(t("er.mlcRequired")); return; }
    try { await save.mutateAsync({ case_id: c.id, mlc, details: d }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("er.mlc")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("er.save")}</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3"><Label htmlFor="mlc-on">{t("er.mlcIs")}</Label><Switch id="mlc-on" checked={mlc} onCheckedChange={setMlc} /></div>
        {mlc && <>{f("fir_no", true, true)}{f("police_station", true)}{f("officer_name", true)}{f("officer_badge", false, true)}{f("brought_by")}{f("injury_summary")}</>}
      </div>
    </SidePanel>
  );
}

function DispositionPanel({ c, onClose, onDone }: { c: EmergencyCase; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [disp, setDisp] = useState<string>("discharge");
  const [note, setNote] = useState("");
  const [bedClass, setBedClass] = useState("general");
  const [priority, setPriority] = useState("urgent");
  const save = useEdgeFunction("set-disposition", { invalidate: ER_INVALIDATE, successMessage: t("er.closed") });
  const submit = async () => {
    try { await save.mutateAsync({ case_id: c.id, disposition: disp, note, bed_class: bedClass, priority }); onClose(); onDone(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={`${t("er.disposition")} · ${c.patients?.full_name ?? ""}`}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("er.confirm")}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => <Button key={d} variant={disp === d ? "default" : "outline"} onClick={() => setDisp(d)}>{t(`er.dispositions.${d}`)}</Button>)}
        </div>
        {disp === "admit" && (
          <>
            <div className="space-y-1.5"><Label>{t("er.bedClass")}</Label>
              <Select value={bedClass} onValueChange={setBedClass}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{WARD_TYPES.filter((w) => w !== "er").map((w) => <SelectItem key={w} value={w}>{t(`wd.types.${w}`, w)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>{t("adm.priority")}</Label>
              <Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["urgent", "routine"].map((p) => <SelectItem key={p} value={p}>{t(`adm.priorities.${p}`)}</SelectItem>)}</SelectContent></Select></div>
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{t("er.admitNote")}</p>
          </>
        )}
        <div className="space-y-1.5"><Label htmlFor="disp-note">{t("er.note")}</Label>
          <Textarea id="disp-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}

export type { TriageColor };
