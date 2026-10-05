import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Plus, Trash2, TrendingDown } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app/purchase-requests")({
  head: () => ({ meta: [
    { title: "Purchase requests — MediCore HMS" },
    { name: "description", content: "Request medicines, approve and receive them into pharmacy stock." },
    { property: "og:title", content: "Purchase requests — MediCore HMS" },
    { property: "og:description", content: "Request medicines, approve and receive them into pharmacy stock." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("purchaseRequests")}>
      <PurchasePage />
    </RequireRole>
  ),
});

type Status = "draft" | "submitted" | "approved" | "rejected" | "received";
interface PrItem { medicine_id: string; medicine_name: string; qty: number; note: string | null }
interface Pr {
  id: string; items: PrItem[]; note: string | null; supplier_id: string | null; requested_by: string | null; status: Status;
  created_at: string; decision_note: string | null; received_batches: { batch_no: string; qty: number; medicine_id: string; expiry_date: string }[];
}
interface Med { id: string; generic_name: string; brand_name: string | null; strength: string | null; reorder_level: number }
const medName = (m: Med) => [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" ");
const todayPk = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const TONE: Record<Status, "secondary" | "outline" | "default" | "destructive"> = { draft: "outline", submitted: "secondary", approved: "default", rejected: "destructive", received: "secondary" };

function useData() {
  return useQuery({
    queryKey: ["purchase"],
    queryFn: async () => {
      const [pr, meds, batches, sup, prof] = await Promise.all([
        supabase.from("purchase_requests" as never).select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("medicines").select("id, generic_name, brand_name, strength, reorder_level").eq("is_active", true).order("generic_name"),
        supabase.from("stock_batches" as never).select("medicine_id, qty_on_hand, expiry_date").gt("qty_on_hand", 0),
        supabase.from("suppliers" as never).select("id, name").order("name"),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (pr.error) throw pr.error;
      const today = todayPk();
      const onHand = new Map<string, number>();
      for (const b of (batches.data ?? []) as unknown as { medicine_id: string; qty_on_hand: number; expiry_date: string }[])
        if (b.expiry_date >= today) onHand.set(b.medicine_id, (onHand.get(b.medicine_id) ?? 0) + b.qty_on_hand);
      return {
        requests: (pr.data ?? []) as unknown as Pr[],
        meds: (meds.data ?? []) as unknown as Med[],
        onHand,
        suppliers: (sup.data ?? []) as unknown as { id: string; name: string }[],
        names: new Map(((prof.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])),
      };
    },
  });
}

function PurchasePage() {
  const { t } = useTranslation();
  const q = useData();
  const [open, setOpen] = useState<Pr | "new" | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t("pr.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pr.hint")}</p>
        </div>
        <Button onClick={() => setOpen("new")}><Plus className="me-1 size-4" />{t("pr.new")}</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.requests.length ? <EmptyState icon={ClipboardList} title={t("pr.empty")} /> : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("pr.created")}</TableHead><TableHead>{t("pr.by")}</TableHead><TableHead>{t("pr.items")}</TableHead><TableHead>{t("pr.status")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {q.data.requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Ltr>{new Date(r.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</Ltr></TableCell>
                  <TableCell>{(r.requested_by && q.data.names.get(r.requested_by)) || "—"}</TableCell>
                  <TableCell className="max-w-xs truncate"><Ltr>{r.items.map((i) => `${i.medicine_name} ×${i.qty}`).join(", ")}</Ltr></TableCell>
                  <TableCell><Badge variant={TONE[r.status]}>{t(`pr.st.${r.status}`)}</Badge></TableCell>
                  <TableCell className="text-end"><Button size="sm" variant="outline" onClick={() => setOpen(r)}>{r.status === "draft" ? t("pr.edit") : t("pr.view")}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {open && q.data && <RequestPanel key={open === "new" ? "new" : open.id} pr={open === "new" ? null : open} data={q.data} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Data = NonNullable<ReturnType<typeof useData>["data"]>;
type Row = { medicine_id: string; qty: string; note: string };
type Rcv = { medicine_id: string; name: string; batch_no: string; expiry_date: string; qty: string; cost_price: string };

function RequestPanel({ pr, data, onClose }: { pr: Pr | null; data: Data; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasRole } = useMyContext();
  const isAdmin = hasRole("admin", "super_admin");
  const status: Status = pr?.status ?? "draft";
  const editable = status === "draft";
  const [rows, setRows] = useState<Row[]>(() => (pr?.items ?? []).map((i) => ({ medicine_id: i.medicine_id, qty: String(i.qty), note: i.note ?? "" })));
  const [note, setNote] = useState(pr?.note ?? "");
  const [supplier, setSupplier] = useState(pr?.supplier_id ?? "");
  const [reason, setReason] = useState("");
  const [rcv, setRcv] = useState<Rcv[]>(() => (pr?.items ?? []).map((i) => ({ medicine_id: i.medicine_id, name: i.medicine_name, batch_no: "", expiry_date: "", qty: String(i.qty), cost_price: "" })));
  const [busy, setBusy] = useState(false);
  const medMap = new Map(data.meds.map((m) => [m.id, m]));

  const run = async (fn: string, body: unknown, msg: string, close = true) => {
    setBusy(true);
    try { const r = await callEdgeFunction<Pr>(fn, body); toast.success(t(msg)); void qc.invalidateQueries({ queryKey: ["purchase"] }); void qc.invalidateQueries({ queryKey: ["stock"] }); if (close) onClose(); return r; }
    catch (e) { toast.error((e as EdgeError).message); return null; } finally { setBusy(false); }
  };
  const addLow = () => {
    const have = new Set(rows.map((r) => r.medicine_id));
    const low = data.meds.filter((m) => m.reorder_level > 0 && (data.onHand.get(m.id) ?? 0) < m.reorder_level && !have.has(m.id));
    if (!low.length) { toast.info(t("pr.addLowNone")); return; }
    // Suggest topping up to twice the reorder level.
    setRows((r) => [...r, ...low.map((m) => ({ medicine_id: m.id, qty: String(Math.max(1, m.reorder_level * 2 - (data.onHand.get(m.id) ?? 0))), note: "" }))]);
    toast.success(t("pr.addLowDone", { n: low.length }));
  };
  const payload = () => ({ id: pr?.id, note, supplier_id: supplier || undefined, items: rows.filter((r) => r.medicine_id).map((r) => ({ medicine_id: r.medicine_id, qty: Number(r.qty), note: r.note || undefined })) });
  const saveThenSubmit = async () => {
    const saved = await run("save-purchase-request", payload(), "pr.saved", false);
    if (saved) await run("submit-purchase-request", { id: saved.id }, "pr.submitted");
  };
  const setRow = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setR = (i: number, p: Partial<Rcv>) => setRcv((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <SidePanel open onOpenChange={(o) => { if (!o) onClose(); }} title={pr ? `${t("pr.title")} · ${t(`pr.st.${status}`)}` : t("pr.new")}
      footer={
        <div className="flex flex-wrap gap-2">
          {editable && <><Button variant="outline" disabled={busy} onClick={() => void run("save-purchase-request", payload(), "pr.saved")}>{t("pr.saveDraft")}</Button>
            <Button disabled={busy || !rows.length} onClick={() => void saveThenSubmit()}>{t("pr.submit")}</Button></>}
          {status === "submitted" && isAdmin && pr && <>
            <Button disabled={busy} onClick={() => void run("decide-purchase-request", { id: pr.id, decision: "approved", note: reason }, "pr.decided")}>{t("pr.approve")}</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void run("decide-purchase-request", { id: pr.id, decision: "rejected", note: reason }, "pr.decided")}>{t("pr.reject")}</Button></>}
          {status === "approved" && pr && <Button disabled={busy} onClick={() => void run("receive-purchase-request", { id: pr.id, supplier_id: supplier || undefined,
            receipts: rcv.map((r) => ({ medicine_id: r.medicine_id, batch_no: r.batch_no, expiry_date: r.expiry_date, qty: Number(r.qty), cost_price: Number(r.cost_price || 0) })) }, "pr.received")}>{t("pr.receive")}</Button>}
        </div>
      }>
      <div className="space-y-4">
        {editable ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={addLow}><TrendingDown className="me-1 size-4" />{t("pr.addLow")}</Button>
              <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { medicine_id: "", qty: "1", note: "" }])}><Plus className="me-1 size-4" />{t("pr.addItem")}</Button>
            </div>
            {rows.map((r, i) => {
              const m = medMap.get(r.medicine_id);
              return (
                <div key={i} className="space-y-2 rounded-lg border p-2">
                  <div className="flex gap-2">
                    <Select value={r.medicine_id} onValueChange={(v) => setRow(i, { medicine_id: v })}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder={t("pr.medicine")} /></SelectTrigger>
                      <SelectContent>{data.meds.map((x) => <SelectItem key={x.id} value={x.id}><Ltr>{medName(x)}</Ltr></SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="w-24" type="number" min={1} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} aria-label={t("pr.qty")} />
                    <Button size="icon" variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="size-4" /></Button>
                  </div>
                  {m && <p className="text-xs text-muted-foreground">{t("pr.onHand")}: <Ltr>{data.onHand.get(m.id) ?? 0}</Ltr> · {t("pr.reorder")}: <Ltr>{m.reorder_level || "—"}</Ltr></p>}
                </div>
              );
            })}
            <div className="space-y-1"><Label>{t("pr.supplier")}</Label>
              <Select value={supplier || "none"} onValueChange={(v) => setSupplier(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">{t("pr.noSupplier")}</SelectItem>{data.suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1"><Label>{t("pr.note")}</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
          </>
        ) : pr && (
          <>
            <ul className="divide-y rounded-lg border text-sm">
              {pr.items.map((i) => <li key={i.medicine_id} className="flex justify-between p-2"><Ltr>{i.medicine_name}</Ltr><Ltr>×{i.qty}</Ltr></li>)}
            </ul>
            {pr.note && <p className="text-sm"><span className="font-medium">{t("pr.note")}:</span> {pr.note}</p>}
            {pr.decision_note && <p className="text-sm"><span className="font-medium">{t("pr.decisionNote")}:</span> {pr.decision_note}</p>}
          </>
        )}

        {status === "submitted" && isAdmin && (
          <div className="space-y-1"><Label>{t("pr.rejectReason")}</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
        )}

        {status === "approved" && (
          <div className="space-y-3">
            <div className="space-y-1"><Label>{t("pr.supplier")}</Label>
              <Select value={supplier || "none"} onValueChange={(v) => setSupplier(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">{t("pr.noSupplier")}</SelectItem>{data.suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select></div>
            {rcv.map((r, i) => (
              <div key={r.medicine_id} className="space-y-2 rounded-lg border p-2">
                <p className="text-sm font-medium"><Ltr>{r.name}</Ltr></p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">{t("pr.batch")}</Label><Input dir="ltr" value={r.batch_no} onChange={(e) => setR(i, { batch_no: e.target.value })} /></div>
                  <div><Label className="text-xs">{t("pr.expiry")}</Label><Input type="date" value={r.expiry_date} min={todayPk()} onChange={(e) => setR(i, { expiry_date: e.target.value })} /></div>
                  <div><Label className="text-xs">{t("pr.qty")}</Label><Input type="number" min={0} value={r.qty} onChange={(e) => setR(i, { qty: e.target.value })} /></div>
                  <div><Label className="text-xs">{t("pr.cost")}</Label><Input type="number" min={0} step="0.01" value={r.cost_price} onChange={(e) => setR(i, { cost_price: e.target.value })} /></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {status === "received" && pr && pr.received_batches.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("pr.receivedBatches")}</p>
            <ul className="divide-y rounded-lg border text-sm">
              {pr.received_batches.map((b, i) => (
                <li key={i} className="flex justify-between p-2"><Ltr>{pr.items.find((x) => x.medicine_id === b.medicine_id)?.medicine_name} · {b.batch_no}</Ltr><Ltr>+{b.qty} · {b.expiry_date}</Ltr></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
