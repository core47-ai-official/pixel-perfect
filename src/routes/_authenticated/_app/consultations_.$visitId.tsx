import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FlaskConical, Lock, Stethoscope } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Banner } from "@/components/mc/banner";
import { SidePanel } from "@/components/mc/side-panel";
import { PatientHeader } from "@/components/mc/patient-header";
import { Ltr } from "@/components/mc/ltr";
import { useMyContext } from "@/hooks/use-my-context";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useDepartmentsData } from "@/lib/departments-data";
import { usePatient } from "@/lib/patients";
import { useAddenda, usePatientVisits, useVisit, useVitals, type Visit } from "@/lib/visits";
import { NOTE_TEMPLATES, templateForSpecialty } from "@/config/note-templates";
import { DiagnosisPicker } from "@/components/mc/diagnosis-picker";
import { PrescriptionPanel } from "@/components/mc/prescription-panel";
import { OrderPicker } from "@/components/mc/order-picker";

export const Route = createFileRoute("/_authenticated/_app/consultations_/$visitId")({
  head: () => ({
    meta: [
      { title: "Consultation — MediCore HMS" },
      { name: "description", content: "Write the consultation note, review history and vitals." },
    ],
  }),
  component: () => (
    <RequireRole roles={rolesForPage("consultations")}>
      <Screen />
    </RequireRole>
  ),
});

type NoteKey = "chief_complaint" | "history" | "examination" | "plan";
type Note = Record<NoteKey, string>;
const KEYS: NoteKey[] = ["chief_complaint", "history", "examination", "plan"];
const AUTOSAVE_MS = 10_000;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const hhmm = (d: Date) => d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

function useWide() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1280px)");
    const on = () => setOk(m.matches); on();
    m.addEventListener("change", on); return () => m.removeEventListener("change", on);
  }, []);
  return ok;
}

function Screen() {
  const { t } = useTranslation();
  const { visitId } = Route.useParams();
  const visit = useVisit(visitId);
  const wide = useWide();
  if (visit.isLoading) return <Skeleton className="h-96" />;
  if (!visit.data) return <Banner tone="warning" title={t("consult.notFound")} />;
  const v = visit.data;
  const left = <LeftPanel visit={v} />;
  const centre = <NotePanel visit={v} />;
  const right = <RightPanel visit={v} />;
  return (
    <div className="space-y-4">
      <PatientHeader patientId={v.patient_id} />
      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] gap-4">{left}{centre}{right}</div>
      ) : (
        <Tabs defaultValue="note">
          <TabsList className="w-full">
            <TabsTrigger value="left" className="flex-1">{t("consult.tabs.left")}</TabsTrigger>
            <TabsTrigger value="note" className="flex-1">{t("consult.tabs.note")}</TabsTrigger>
            <TabsTrigger value="right" className="flex-1">{t("consult.tabs.right")}</TabsTrigger>
          </TabsList>
          <TabsContent value="left">{left}</TabsContent>
          <TabsContent value="note" forceMount className="data-[state=inactive]:hidden">{centre}</TabsContent>
          <TabsContent value="right">{right}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- centre: note */

function NotePanel({ visit }: { visit: Visit }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { context } = useMyContext();
  const { doctors } = useDepartmentsData();
  const me = (doctors.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const canEdit = visit.status === "draft" && me?.id === visit.doctor_id;

  const [note, setNote] = useState<Note>(() => ({
    chief_complaint: visit.chief_complaint, history: visit.history, examination: visit.examination, plan: visit.plan,
  }));
  const [tpl, setTpl] = useState<string>(visit.template ?? "");
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [completing, setCompleting] = useState(false);
  const dirty = useRef(false);
  const latest = useRef(note);
  latest.current = note;
  const tplRef = useRef(tpl);
  tplRef.current = tpl;

  useEffect(() => {
    if (!visit.template && me) setTpl(templateForSpecialty(me.specialty).id);
  }, [me, visit.template]);

  const save = useCallback(async () => {
    if (!dirty.current || !canEdit) return;
    dirty.current = false;
    setState("saving");
    try {
      await callEdgeFunction("save-visit-draft", { visit_id: visit.id, ...latest.current, template: tplRef.current || null });
      setSavedAt(new Date()); setState(dirty.current ? "dirty" : "saved");
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "locked") { void qc.invalidateQueries({ queryKey: ["visits", "one", visit.id] }); return; }
      dirty.current = true; setState("error");
    }
  }, [canEdit, visit.id, qc]);

  // Autosave every 10 s, plus when the tab is hidden or the page is left.
  useEffect(() => {
    if (!canEdit) return;
    const h = setInterval(() => void save(), AUTOSAVE_MS);
    const onHide = () => { if (document.visibilityState === "hidden") void save(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); void save(); };
  }, [canEdit, save]);
  useEffect(() => {
    if (!canEdit) return;
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { void save(); e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [canEdit, save]);

  const change = (k: NoteKey, val: string) => { setNote((n) => ({ ...n, [k]: val })); dirty.current = true; setState("dirty"); };
  const applyTemplate = () => {
    const tp = NOTE_TEMPLATES.find((x) => x.id === tpl); if (!tp) return;
    setNote((n) => ({
      ...n,
      history: n.history.trim() ? n.history : tp.fields.history,
      examination: n.examination.trim() ? n.examination : tp.fields.examination,
      plan: n.plan.trim() ? n.plan : tp.fields.plan,
    }));
    dirty.current = true; setState("dirty");
  };
  const complete = async () => {
    setCompleting(true);
    try {
      await callEdgeFunction("complete-consultation", { visit_id: visit.id, ...latest.current });
      dirty.current = false;
      toast.success(t("consult.completed"));
      await qc.invalidateQueries({ queryKey: ["visits"] });
      void qc.invalidateQueries({ queryKey: ["appointments"] });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setCompleting(false); setConfirm(false); }
  };

  const status = state === "saving" ? t("consult.saving") : state === "error" ? t("consult.saveFailed")
    : state === "dirty" ? t("consult.unsaved") : savedAt ? t("consult.saved", { time: hhmm(savedAt) }) : "";

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Stethoscope className="size-4" />{t("consult.note")}</h2>
        {visit.status === "completed" ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Lock className="size-4" />{t("consult.locked", { time: fmt(visit.completed_at!) })}</span>
        ) : <span className={state === "error" ? "text-sm text-urgent" : "text-sm text-muted-foreground"} aria-live="polite">{status}</span>}
      </header>

      {visit.status === "draft" && !canEdit && me !== undefined && <Banner tone="info" title={t("consult.readOnly")} />}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>{t("consult.template")}</Label>
            <Select value={tpl} onValueChange={(v) => { setTpl(v); dirty.current = true; }}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{NOTE_TEMPLATES.map((x) => <SelectItem key={x.id} value={x.id}>{t(`consult.tpl.${x.id}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={applyTemplate}>{t("consult.applyTemplate")}</Button>
        </div>
      )}

      {KEYS.map((k) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={k}>{t(k === "history" ? "consult.historyField" : `consult.${k}`)}{k === "chief_complaint" && canEdit ? " *" : ""}</Label>
          {canEdit ? (
            <Textarea id={k} dir="auto" value={note[k]} onChange={(e) => change(k, e.target.value)} onBlur={() => void save()}
              rows={k === "chief_complaint" ? 2 : 6} className="font-mono text-sm" />
          ) : (
            <p id={k} dir="auto" className="min-h-10 whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">{note[k] || "—"}</p>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setConfirm(true)} disabled={!note.chief_complaint.trim() || completing}>{t("consult.complete")}</Button>
        </div>
      )}
      {visit.status === "completed" && <Addenda visitId={visit.id} canAdd={!!me} />}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consult.complete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("consult.completeConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void complete(); }} disabled={completing}>{t("consult.complete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Addenda({ visitId, canAdd }: { visitId: string; canAdd: boolean }) {
  const { t } = useTranslation();
  const list = useAddenda(visitId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("add-visit-addendum", { visit_id: visitId, body: text });
      setText(""); toast.success(t("consult.addendumSaved")); await list.refetch();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="font-semibold">{t("consult.addenda")}</h3>
      {(list.data ?? []).map((a) => (
        <div key={a.id} className="rounded-md border-s-4 border-s-primary bg-muted/40 px-3 py-2 text-sm">
          <p className="mb-1 text-xs text-muted-foreground">{a.author_name} · <Ltr>{fmt(a.created_at)}</Ltr></p>
          <p dir="auto" className="whitespace-pre-wrap">{a.body}</p>
        </div>
      ))}
      {canAdd && (
        <>
          <Textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("consult.addendumPh")} rows={3} />
          <div className="flex justify-end"><Button onClick={add} disabled={busy || text.trim().length < 3}>{t("consult.addAddendum")}</Button></div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- left: history etc */

function LeftPanel({ visit }: { visit: Visit }) {
  const { t } = useTranslation();
  const patient = usePatient(visit.patient_id);
  const visits = usePatientVisits(visit.patient_id);
  const vitals = useVitals(visit.patient_id);
  const [vOpen, setVOpen] = useState(false);
  const past = (visits.data ?? []).filter((v) => v.id !== visit.id);
  const p = patient.data as { allergies?: string[]; chronic_conditions?: string[] } | null | undefined;
  return (
    <aside className="space-y-4">
      <section className="rounded-lg border bg-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">{t("consult.history")}</h2>
        <p className="text-xs text-muted-foreground">{t("consult.allergies")}</p>
        <p className="mb-2">{p?.allergies?.length ? p.allergies.join(", ") : "—"}</p>
        <p className="text-xs text-muted-foreground">{t("consult.chronic")}</p>
        <p>{p?.chronic_conditions?.length ? p.chronic_conditions.join(", ") : "—"}</p>
      </section>

      <section className="rounded-lg border bg-card p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t("consult.vitalsTrend")}</h2>
          <Button size="sm" variant="outline" onClick={() => setVOpen(true)}>{t("consult.recordVitals")}</Button>
        </div>
        {(vitals.data ?? []).length === 0 ? <p className="text-muted-foreground">{t("consult.noVitals")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="py-1 text-start" /><th>{t("consult.v.bp")}</th><th>{t("consult.v.pulse")}</th><th>{t("consult.v.temp")}</th><th>{t("consult.v.spo2")}</th><th>{t("consult.v.weight")}</th></tr>
              </thead>
              <tbody>
                {vitals.data!.map((r) => (
                  <tr key={r.id} className="border-t text-center">
                    <td className="py-1 text-start"><Ltr>{new Date(r.recorded_at).toLocaleDateString("en-PK", { day: "2-digit", month: "short" })}</Ltr></td>
                    <td><Ltr>{r.bp_sys && r.bp_dia ? `${r.bp_sys}/${r.bp_dia}` : "—"}</Ltr></td>
                    <td><Ltr>{r.pulse ?? "—"}</Ltr></td><td><Ltr>{r.temp_c ?? "—"}</Ltr></td>
                    <td><Ltr>{r.spo2 ?? "—"}</Ltr></td><td><Ltr>{r.weight_kg ?? "—"}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">{t("consult.pastVisits")}</h2>
        {past.length === 0 ? <p className="text-muted-foreground">{t("consult.noVisits")}</p> : (
          <ul className="space-y-2">
            {past.slice(0, 10).map((v) => (
              <li key={v.id}>
                <Link to="/consultations/$visitId" params={{ visitId: v.id }} className="block rounded-md border px-3 py-2 hover:bg-accent">
                  <p className="text-xs text-muted-foreground"><Ltr>{fmt(v.created_at)}</Ltr> · {v.type.toUpperCase()}</p>
                  <p className="truncate">{v.chief_complaint || "—"}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <VitalsPanel open={vOpen} onOpenChange={setVOpen} patientId={visit.patient_id} visitId={visit.id} />
    </aside>
  );
}

const VITAL_FIELDS = ["bp_sys", "bp_dia", "pulse", "temp_c", "spo2", "rr", "weight_kg", "height_cm"] as const;

function VitalsPanel({ open, onOpenChange, patientId, visitId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string; visitId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("record-vitals", { patient_id: patientId, visit_id: visitId, ...vals });
      toast.success(t("consult.vitalsSaved")); setVals({}); onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["vitals", patientId] });
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally { setBusy(false); }
  };
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("consult.recordVitals")}
      footer={<Button onClick={save} disabled={busy}>{t("consult.save")}</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {VITAL_FIELDS.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`v-${k}`}>{t(`consult.v.${k === "pulse" || k === "spo2" || k === "rr" ? k : k}`)}</Label>
            <Input id={`v-${k}`} inputMode="decimal" dir="ltr" value={vals[k] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------- right: placeholders B12-B15 */

function RightPanel({ visit }: { visit: Visit }) {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const { doctors } = useDepartmentsData();
  const me = (doctors.data ?? []).find((d) => d.user_id === context?.profile?.id);
  const canEdit = visit.status === "draft" && me?.id === visit.doctor_id;
  const box = (icon: React.ReactNode, title: string) => (
    <section className="rounded-lg border border-dashed bg-card p-4 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">{icon}{title}</h2>
      <p className="text-muted-foreground">{t("consult.soon")}</p>
    </section>
  );
  return (
    <aside className="space-y-4">
      <DiagnosisPicker visitId={visit.id} canEdit={canEdit} />
      <OrderPicker visitId={visit.id} canEdit={canEdit} />
      <PrescriptionPanel visit={visit} canEdit={canEdit} />
    </aside>
  );
}
