import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle2, Play, Plus, Circle } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Banner } from "@/components/mc/banner";
import { EmptyState } from "@/components/mc/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useBookableDoctors } from "@/lib/appointments";
import { CHECKLIST_ITEMS, CHECKLIST_KINDS, type ChecklistKind, type OtBooking, useTheatres } from "@/lib/ot";

export const Route = createFileRoute("/_authenticated/_app/ot_/$bookingId")({
  head: () => ({ meta: [
    { title: "OT case — MediCore HMS" },
    { name: "description", content: "Checklists, operation note and consumables for one OT case." },
    { property: "og:title", content: "OT case — MediCore HMS" },
    { property: "og:description", content: "Checklists, operation note and consumables for one OT case." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("ot")}>
      <OtCasePage />
    </RequireRole>
  ),
});

const TONE: Record<string, Status> = { requested: "caution", scheduled: "progress", in_progress: "warning", completed: "ok", cancelled: "inactive", bumped: "urgent" };
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

interface Checklist { kind: ChecklistKind; items: Record<string, boolean>; completed_at: string | null }
interface Note { anesthesia_note: string | null; operation_note: string | null; findings: string | null; complications: string | null; updated_at: string }
interface Consumable { id: string; medicine_or_item: string; qty: number; unit_price: number; created_at: string }

function OtCasePage() {
  const { bookingId } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const docs = useBookableDoctors();
  const theatres = useTheatres();
  const key = ["ot", "case", bookingId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [b, cl, n, co] = await Promise.all([
        supabase.from("ot_bookings").select("*, patients(full_name, mrn)").eq("id", bookingId).maybeSingle(),
        supabase.from("ot_checklists").select("kind, items, completed_at").eq("booking_id", bookingId),
        supabase.from("operation_notes").select("anesthesia_note, operation_note, findings, complications, updated_at").eq("booking_id", bookingId).maybeSingle(),
        supabase.from("ot_consumables").select("id, medicine_or_item, qty, unit_price, created_at").eq("booking_id", bookingId).order("created_at"),
      ]);
      if (b.error) throw b.error;
      return { booking: b.data as unknown as OtBooking | null, checklists: (cl.data ?? []) as unknown as Checklist[], note: n.data as Note | null, consumables: (co.data ?? []) as unknown as Consumable[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ot"] });

  if (q.isLoading) return <Skeleton className="h-64" />;
  const bk = q.data?.booking;
  if (!bk) return <EmptyState title={t("ot.caseNotFound")} />;
  const docName = (id: string | null) => (id ? docs.data?.find((d) => d.id === id)?.full_name ?? "—" : "—");
  const doneKinds = new Set(q.data!.checklists.filter((c) => c.completed_at).map((c) => c.kind));
  const canStart = doneKinds.has("pre_op") && doneKinds.has("who_sign_in");

  const act = async (fn: string) => {
    try {
      const r = await callEdgeFunction<{ charge_missing?: boolean }>(fn, { booking_id: bk.id });
      toast.success(t(fn === "start-ot-case" ? "ot.started" : "ot.completed"));
      if (r?.charge_missing) toast.warning(t("ot.chargeMissing"));
    } catch (e) { toast.error((e as EdgeError).message); }
    void refresh();
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild><Link to="/ot"><ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.ot")}</Link></Button>
      <div className="flex flex-wrap items-start gap-3 rounded-staff border bg-card p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{bk.procedure}</h1>
            <StatusChip status={TONE[bk.status] ?? "inactive"}>{t(`ot.bstatus.${bk.status}`)}</StatusChip>
            <StatusChip status={bk.priority === "emergency" ? "urgent" : "ok"}>{t(`cal.legend.otPriority.${bk.priority}`)}</StatusChip>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link to="/patients/$patientId" params={{ patientId: bk.patient_id }} className="font-medium text-foreground hover:underline">{bk.patients?.full_name}</Link>{" "}
            <Ltr>{bk.patients?.mrn}</Ltr> · {t("ot.surgeon")}: {docName(bk.surgeon_id)} · {t("ot.anesthetist")}: {docName(bk.anesthetist_id)}
          </p>
          <p className="text-sm text-muted-foreground">
            {theatres.data?.find((o) => o.id === bk.ot_id)?.name ?? "—"}
            {bk.planned_start && <> · <Ltr>{format(new Date(bk.planned_start), "dd MMM yyyy, HH:mm")}</Ltr></>}
          </p>
        </div>
        <div className="flex gap-2">
          {bk.status === "scheduled" && <Button onClick={() => act("start-ot-case")} disabled={!canStart} title={canStart ? undefined : t("ot.startBlocked")}><Play className="size-4" />{t("ot.start_case")}</Button>}
          {bk.status === "in_progress" && <Button onClick={() => act("complete-ot-case")}><CheckCircle2 className="size-4" />{t("ot.complete_case")}</Button>}
        </div>
      </div>
      {bk.status === "scheduled" && !canStart && <Banner tone="warning" title={t("ot.startBlocked")} />}

      <Tabs defaultValue="pre_op">
        <TabsList className="flex-wrap h-auto">
          {CHECKLIST_KINDS.map((k) => (
            <TabsTrigger key={k} value={k} className="gap-1.5">
              {doneKinds.has(k) ? <CheckCircle2 className="size-3.5 text-ok" /> : <Circle className="size-3.5 text-muted-foreground" />}{t(`ot.kinds.${k}`)}
            </TabsTrigger>
          ))}
          <TabsTrigger value="note">{t("ot.opNote")}</TabsTrigger>
          <TabsTrigger value="consumables">{t("ot.consumables")}</TabsTrigger>
        </TabsList>
        {CHECKLIST_KINDS.map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <ChecklistForm bookingId={bk.id} kind={k} saved={q.data!.checklists.find((c) => c.kind === k)} closed={["cancelled", "completed"].includes(bk.status)} onSaved={refresh} />
          </TabsContent>
        ))}
        <TabsContent value="note" className="mt-4"><NoteForm bookingId={bk.id} saved={q.data!.note} onSaved={refresh} /></TabsContent>
        <TabsContent value="consumables" className="mt-4"><Consumables bookingId={bk.id} rows={q.data!.consumables} canLog={["scheduled", "in_progress", "completed"].includes(bk.status)} onSaved={refresh} /></TabsContent>
      </Tabs>
    </div>
  );
}

function ChecklistForm({ bookingId, kind, saved, closed, onSaved }: { bookingId: string; kind: ChecklistKind; saved: Checklist | undefined; closed: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setItems(saved?.items ?? {}); }, [saved]);
  const keys = CHECKLIST_ITEMS[kind];
  const done = keys.filter((k) => items[k]).length;
  const save = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("save-ot-checklist", { booking_id: bookingId, kind, items });
      toast.success(done === keys.length ? t("ot.checklistDone") : t("ot.checklistSaved"));
      onSaved();
    } catch (e) { toast.error((e as EdgeError).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 rounded-staff border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground"><Ltr>{done}/{keys.length}</Ltr> {t("ot.ticked")}</span>
        {saved?.completed_at && <StatusChip status="ok">{t("ot.completedAt")} <Ltr>{format(new Date(saved.completed_at), "dd MMM HH:mm")}</Ltr></StatusChip>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {keys.map((k) => (
          <label key={k} className="flex items-start gap-2 rounded-staff border p-2.5 text-sm">
            <Checkbox checked={!!items[k]} disabled={closed} onCheckedChange={(v) => setItems({ ...items, [k]: v === true })} className="mt-0.5" />
            <span>{t(`ot.items.${k}`)}</span>
          </label>
        ))}
      </div>
      {!closed && <Button onClick={save} disabled={busy}>{t("ot.save")}</Button>}
    </div>
  );
}

function NoteForm({ bookingId, saved, onSaved }: { bookingId: string; saved: Note | null; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ anesthesia_note: "", operation_note: "", findings: "", complications: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ anesthesia_note: saved?.anesthesia_note ?? "", operation_note: saved?.operation_note ?? "", findings: saved?.findings ?? "", complications: saved?.complications ?? "" });
  }, [saved]);
  const save = async () => {
    setBusy(true);
    try { await callEdgeFunction("save-operation-note", { booking_id: bookingId, ...f }); toast.success(t("ot.noteSaved")); onSaved(); }
    catch (e) { toast.error((e as EdgeError).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 rounded-staff border bg-card p-4">
      {(["anesthesia_note", "operation_note", "findings", "complications"] as const).map((k) => (
        <div key={k} className="space-y-1.5">
          <Label>{t(`ot.noteFields.${k}`)}</Label>
          <Textarea rows={k === "operation_note" ? 6 : 3} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={8000} />
        </div>
      ))}
      {saved && <p className="text-xs text-muted-foreground">{t("ot.lastSaved")} <Ltr>{format(new Date(saved.updated_at), "dd MMM HH:mm")}</Ltr></p>}
      <Button onClick={save} disabled={busy}>{t("ot.save")}</Button>
    </div>
  );
}

function Consumables({ bookingId, rows, canLog, onSaved }: { bookingId: string; rows: Consumable[]; canLog: boolean; onSaved: () => void }) {
  const { t } = useTranslation();
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((s, r) => s + Number(r.qty) * Number(r.unit_price), 0);
  const add = async () => {
    if (!item.trim() || !(Number(qty) > 0) || price === "") { toast.error(t("ot.consumableNeeds")); return; }
    setBusy(true);
    try {
      await callEdgeFunction("log-ot-consumable", { booking_id: bookingId, medicine_or_item: item, qty: Number(qty), unit_price: Number(price) });
      toast.success(t("ot.consumableLogged")); setItem(""); setQty("1"); setPrice(""); onSaved();
    } catch (e) { toast.error((e as EdgeError).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 rounded-staff border bg-card p-4">
      {canLog && (
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_auto] sm:items-end">
          <div className="space-y-1.5"><Label>{t("ot.item")}</Label><Input value={item} onChange={(e) => setItem(e.target.value)} maxLength={200} /></div>
          <div className="space-y-1.5"><Label>{t("ot.qty")}</Label><Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("ot.unitPrice")}</Label><Input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <Button onClick={add} disabled={busy}><Plus className="size-4" />{t("ot.addItem")}</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("ot.consumableHint")}</p>
      {rows.length === 0 ? <EmptyState title={t("ot.noConsumables")} /> : (
        <Table>
          <TableHeader><TableRow><TableHead>{t("ot.item")}</TableHead><TableHead className="text-end">{t("ot.qty")}</TableHead><TableHead className="text-end">{t("ot.unitPrice")}</TableHead><TableHead className="text-end">{t("ot.amount")}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Ltr>{r.medicine_or_item}</Ltr></TableCell>
                <TableCell className="text-end"><Ltr>{Number(r.qty)}</Ltr></TableCell>
                <TableCell className="text-end"><Ltr>{rs(Number(r.unit_price))}</Ltr></TableCell>
                <TableCell className="text-end"><Ltr>{rs(Number(r.qty) * Number(r.unit_price))}</Ltr></TableCell>
              </TableRow>
            ))}
            <TableRow><TableCell colSpan={3} className="font-semibold">{t("ot.total")}</TableCell><TableCell className="text-end font-semibold"><Ltr>{rs(total)}</Ltr></TableCell></TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
