import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus, Search, Plus, SlidersHorizontal } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { EmptyState } from "@/components/mc/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app/inventory")({
  head: () => ({ meta: [
    { title: "Pharmacy stock — MediCore HMS" },
    { name: "description", content: "Stock on hand per medicine, batches, expiry and suppliers." },
    { property: "og:title", content: "Pharmacy stock — MediCore HMS" },
    { property: "og:description", content: "Stock on hand per medicine, batches, expiry and suppliers." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("inventory")}>
      <StockPage />
    </RequireRole>
  ),
});

interface Med { id: string; generic_name: string; brand_name: string | null; strength: string | null; form: string; reorder_level: number }
interface Batch { id: string; medicine_id: string; batch_no: string; expiry_date: string; qty_received: number; qty_on_hand: number; cost_price: number; supplier_id: string | null; received_at: string }
interface Supplier { id: string; name: string; phone: string | null; address: string | null; ntn: string | null; is_active: boolean }

const NONE = "__none";
const medName = (m: Med) => [m.brand_name || m.generic_name, m.strength].filter(Boolean).join(" ");
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const daysUntil = (ymd: string) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayYmd()}T00:00:00Z`)) / 86400e3);
/** Expiry colours: red within 30 days (or expired), amber within 90. */
export const expiryTone = (ymd: string): Status => { const d = daysUntil(ymd); return d <= 30 ? "urgent" : d <= 90 ? "warning" : "ok"; };

function useStock() {
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  return useQuery({
    queryKey: ["stock", hid], enabled: !!hid,
    queryFn: async () => {
      const [m, b, s] = await Promise.all([
        supabase.from("medicines").select("id, generic_name, brand_name, strength, form, reorder_level").eq("is_active", true).order("generic_name"),
        supabase.from("stock_batches").select("*").order("expiry_date"),
        supabase.from("suppliers").select("*").order("name"),
      ]);
      if (m.error) throw m.error;
      if (b.error) throw b.error;
      return { meds: (m.data ?? []) as unknown as Med[], batches: (b.data ?? []) as unknown as Batch[], suppliers: (s.data ?? []) as unknown as Supplier[] };
    },
  });
}

function StockPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin", "admin", "pharmacist");
  const q = useStock();
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [openMed, setOpenMed] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ medicineId: string | null } | null>(null);

  const rows = useMemo(() => {
    const today = todayYmd();
    const byMed = new Map<string, Batch[]>();
    for (const b of q.data?.batches ?? []) byMed.set(b.medicine_id, [...(byMed.get(b.medicine_id) ?? []), b]);
    return (q.data?.meds ?? []).map((m) => {
      const live = (byMed.get(m.id) ?? []).filter((b) => b.qty_on_hand > 0);
      const usable = live.filter((b) => b.expiry_date >= today).reduce((s, b) => s + b.qty_on_hand, 0);
      const nearest = live[0]?.expiry_date ?? null;
      return { m, live, onHand: usable, nearest, low: m.reorder_level > 0 && usable < m.reorder_level };
    });
  }, [q.data]);
  const s = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!lowOnly || r.low) && (!s || medName(r.m).toLowerCase().includes(s) || r.m.generic_name.toLowerCase().includes(s)));
  const lowCount = rows.filter((r) => r.low).length;
  const current = rows.find((r) => r.m.id === openMed) ?? null;

  if (q.isLoading) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t("stock.title")}</h1>
        {canEdit && <Button className="ms-auto" size="sm" onClick={() => setReceive({ medicineId: null })}><PackagePlus className="size-4" />{t("stock.receive")}</Button>}
      </div>
      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">{t("stock.onHandTab")}</TabsTrigger>
          <TabsTrigger value="suppliers">{t("stock.suppliers")}</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("stock.search")} />
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={lowOnly} onCheckedChange={setLowOnly} />{t("stock.lowOnly")} <Ltr className="text-muted-foreground">({lowCount})</Ltr></label>
            <div className="ms-auto flex gap-3 text-xs text-muted-foreground">
              <StatusChip status="warning">{t("stock.legend90")}</StatusChip><StatusChip status="urgent">{t("stock.legend30")}</StatusChip>
            </div>
          </div>
          {shown.length === 0 ? <EmptyState title={lowOnly ? t("stock.noLow") : t("stock.noMeds")} /> : (
            <div className="rounded-staff border bg-card">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("stock.medicine")}</TableHead><TableHead className="text-end">{t("stock.onHand")}</TableHead>
                  <TableHead className="text-end">{t("stock.reorder")}</TableHead><TableHead>{t("stock.nearestExpiry")}</TableHead><TableHead className="text-end">{t("stock.batches")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.m.id} className="cursor-pointer" onClick={() => setOpenMed(r.m.id)}>
                      <TableCell><Ltr className="font-medium">{medName(r.m)}</Ltr><div className="text-xs text-muted-foreground"><Ltr>{r.m.generic_name}</Ltr> · {r.m.form}</div></TableCell>
                      <TableCell className="text-end"><span className="inline-flex items-center gap-2">{r.low && <StatusChip status="urgent">{t("stock.low")}</StatusChip>}<Ltr className="font-semibold">{r.onHand}</Ltr></span></TableCell>
                      <TableCell className="text-end"><Ltr>{r.m.reorder_level || "—"}</Ltr></TableCell>
                      <TableCell>{r.nearest ? <StatusChip status={expiryTone(r.nearest)}><Ltr>{r.nearest}</Ltr></StatusChip> : "—"}</TableCell>
                      <TableCell className="text-end"><Ltr>{r.live.length}</Ltr></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="suppliers" className="mt-4"><Suppliers rows={q.data?.suppliers ?? []} canEdit={canEdit} /></TabsContent>
      </Tabs>

      <SidePanel open={!!current} onOpenChange={(o) => !o && setOpenMed(null)} title={current ? medName(current.m) : ""}
        footer={canEdit && current && <Button onClick={() => setReceive({ medicineId: current.m.id })}><PackagePlus className="size-4" />{t("stock.receive")}</Button>}>
        {current && <BatchDrill med={current.m} batches={(q.data?.batches ?? []).filter((b) => b.medicine_id === current.m.id)} suppliers={q.data?.suppliers ?? []} canEdit={canEdit} onHand={current.onHand} />}
      </SidePanel>
      <ReceivePanel open={!!receive} onOpenChange={(o) => !o && setReceive(null)} medicineId={receive?.medicineId ?? null} meds={q.data?.meds ?? []} suppliers={q.data?.suppliers ?? []} />
    </div>
  );
}

function BatchDrill({ med, batches, suppliers, canEdit, onHand }: { med: Med; batches: Batch[]; suppliers: Supplier[]; canEdit: boolean; onHand: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [level, setLevel] = useState(String(med.reorder_level));
  const [adjust, setAdjust] = useState<Batch | null>(null);
  const saveLevel = async () => {
    try { await callEdgeFunction("adjust-stock", { medicine_id: med.id, reorder_level: Number(level) }); toast.success(t("stock.levelSaved")); }
    catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["stock"] });
  };
  const supplier = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? "—";
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-end gap-2">
        <div className="flex-1"><span className="text-muted-foreground">{t("stock.onHand")}</span><div className="text-2xl font-semibold"><Ltr>{onHand}</Ltr></div></div>
        {canEdit && <><div className="w-28 space-y-1"><Label>{t("stock.reorder")}</Label><Input type="number" min={0} value={level} onChange={(e) => setLevel(e.target.value)} /></div>
          <Button variant="outline" onClick={saveLevel}>{t("stock.save")}</Button></>}
      </div>
      {batches.length === 0 ? <EmptyState title={t("stock.noBatches")} /> : batches.map((b) => {
        const d = daysUntil(b.expiry_date);
        return (
          <div key={b.id} className="space-y-1 rounded-staff border p-3">
            <div className="flex items-center justify-between gap-2">
              <Ltr className="font-semibold">{b.batch_no}</Ltr>
              <StatusChip status={b.qty_on_hand === 0 ? "inactive" : expiryTone(b.expiry_date)}>
                <Ltr>{b.expiry_date}</Ltr> · {d < 0 ? t("stock.expired") : t("stock.daysLeft", { n: d })}
              </StatusChip>
            </div>
            <div className="text-muted-foreground">
              {t("stock.onHand")}: <Ltr className="font-medium text-foreground">{b.qty_on_hand}</Ltr> / <Ltr>{b.qty_received}</Ltr> · {t("stock.cost")}: <Ltr>{`Rs ${Number(b.cost_price).toLocaleString("en-PK")}`}</Ltr> · {supplier(b.supplier_id)}
            </div>
            {canEdit && <Button variant="ghost" size="sm" onClick={() => setAdjust(b)}><SlidersHorizontal className="size-4" />{t("stock.adjust")}</Button>}
          </div>
        );
      })}
      <AdjustPanel batch={adjust} onOpenChange={(o) => !o && setAdjust(null)} />
    </div>
  );
}

function AdjustPanel({ batch, onOpenChange }: { batch: Batch | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("count");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const submit = async () => {
    if (!batch || qty === "") return;
    try {
      await callEdgeFunction("adjust-stock", reason === "count"
        ? { batch_id: batch.id, new_qty: Number(qty), reason, note }
        : { batch_id: batch.id, qty_change: -Math.abs(Number(qty)), reason, note });
      toast.success(t("stock.adjusted")); setQty(""); setNote(""); onOpenChange(false);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["stock"] });
  };
  return (
    <SidePanel open={!!batch} onOpenChange={onOpenChange} title={t("stock.adjustTitle")} footer={<Button onClick={submit}>{t("stock.save")}</Button>}>
      {batch && (
        <div className="space-y-4">
          <p className="text-sm">{t("stock.batch")} <Ltr className="font-semibold">{batch.batch_no}</Ltr> · {t("stock.onHand")} <Ltr>{batch.qty_on_hand}</Ltr></p>
          <div className="space-y-1.5"><Label>{t("stock.reason")}</Label>
            <Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["count", "damaged", "expired"].map((r) => <SelectItem key={r} value={r}>{t(`stock.reasons.${r}`)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>{reason === "count" ? t("stock.countedQty") : t("stock.removeQty")}</Label><Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("stock.note")}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
        </div>
      )}
    </SidePanel>
  );
}

function ReceivePanel({ open, onOpenChange, medicineId, meds, suppliers }: { open: boolean; onOpenChange: (o: boolean) => void; medicineId: string | null; meds: Med[]; suppliers: Supplier[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ medicine_id: "", batch_no: "", expiry_date: "", qty: "", cost_price: "", supplier_id: "" });
  const [key, setKey] = useState<string | null>(null);
  if (open && key !== (medicineId ?? "new")) { setKey(medicineId ?? "new"); setF({ medicine_id: medicineId ?? "", batch_no: "", expiry_date: "", qty: "", cost_price: "", supplier_id: "" }); }
  if (!open && key !== null) setKey(null);
  const submit = async () => {
    if (!f.medicine_id || !f.batch_no || !f.expiry_date || !f.qty) { toast.error(t("stock.fillRequired")); return; }
    try {
      const r = await callEdgeFunction<{ days_to_expiry: number; alert_queued: boolean }>("receive-stock", {
        ...f, qty: Number(f.qty), cost_price: Number(f.cost_price || 0), supplier_id: f.supplier_id || null,
      });
      toast.success(t("stock.received"));
      if (r.alert_queued) toast.warning(t("stock.expiryAlertQueued", { n: r.days_to_expiry }));
      onOpenChange(false);
    } catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["stock"] });
  };
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("stock.receive")} footer={<Button onClick={submit}>{t("stock.receive")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>{t("stock.medicine")}</Label>
          <Select value={f.medicine_id || NONE} onValueChange={(v) => setF({ ...f, medicine_id: v === NONE ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE} disabled>{t("stock.chooseMedicine")}</SelectItem>{meds.map((m) => <SelectItem key={m.id} value={m.id}>{medName(m)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>{t("stock.batch")}</Label><Input value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} maxLength={60} /></div>
          <div className="space-y-1.5"><Label>{t("stock.expiry")}</Label><Input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} />
            {f.expiry_date && <StatusChip status={expiryTone(f.expiry_date)}>{t("stock.daysLeft", { n: daysUntil(f.expiry_date) })}</StatusChip>}</div>
          <div className="space-y-1.5"><Label>{t("stock.qty")}</Label><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("stock.costEach")}</Label><Input type="number" min={0} step="any" value={f.cost_price} onChange={(e) => setF({ ...f, cost_price: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5"><Label>{t("stock.supplier")}</Label>
          <Select value={f.supplier_id || NONE} onValueChange={(v) => setF({ ...f, supplier_id: v === NONE ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("stock.noSupplier")}</SelectItem>{suppliers.filter((s) => s.is_active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
    </SidePanel>
  );
}

function Suppliers({ rows, canEdit }: { rows: Supplier[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const save = async () => {
    try { await callEdgeFunction("upsert-supplier", edit ?? {}); toast.success(t("stock.supplierSaved")); setEdit(null); }
    catch (e) { toast.error((e as EdgeError).message); }
    void qc.invalidateQueries({ queryKey: ["stock"] });
  };
  return (
    <div className="space-y-3">
      {canEdit && <Button size="sm" onClick={() => setEdit({ name: "", is_active: true })}><Plus className="size-4" />{t("stock.addSupplier")}</Button>}
      {rows.length === 0 ? <EmptyState title={t("stock.noSuppliers")} /> : (
        <div className="rounded-staff border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>{t("stock.name")}</TableHead><TableHead>{t("stock.phone")}</TableHead><TableHead>{t("stock.ntn")}</TableHead><TableHead>{t("stock.address")}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((s) => (
              <TableRow key={s.id} className={canEdit ? "cursor-pointer" : ""} onClick={() => canEdit && setEdit(s)}>
                <TableCell className="font-medium">{s.name}{!s.is_active && <StatusChip status="inactive" className="ms-2">{t("stock.inactive")}</StatusChip>}</TableCell>
                <TableCell><Ltr>{s.phone ?? "—"}</Ltr></TableCell><TableCell><Ltr>{s.ntn ?? "—"}</Ltr></TableCell><TableCell>{s.address ?? "—"}</TableCell>
              </TableRow>))}</TableBody>
          </Table>
        </div>
      )}
      <SidePanel open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? t("stock.editSupplier") : t("stock.addSupplier")} footer={<Button onClick={save}>{t("stock.save")}</Button>}>
        {edit && (
          <div className="space-y-4">
            {(["name", "phone", "ntn", "address"] as const).map((k) => (
              <div key={k} className="space-y-1.5"><Label>{t(`stock.${k}`)}</Label><Input value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></div>
            ))}
            <label className="flex items-center gap-2 text-sm"><Switch checked={edit.is_active !== false} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} />{t("stock.active")}</label>
          </div>
        )}
      </SidePanel>
    </div>
  );
}
