import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Layers, Wind, Activity } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/ward-setup")({
  head: () => ({ meta: [{ title: "Ward setup — MediCore HMS" }, { name: "description", content: "Set up hospital wards, rooms and beds with rates and equipment." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("wardSetup")}>
      <WardSetupPage />
    </RequireRole>
  ),
});

export const WARD_TYPES = ["general", "semi_private", "private", "hdu", "icu", "nicu", "isolation", "er"] as const;
export const WARD_GENDERS = ["male", "female", "any"] as const;
export const BED_STATUSES = ["free", "occupied", "cleaning", "reserved", "out_of_service"] as const;
const STATUS_TONE: Record<string, string> = { free: "ok", occupied: "urgent", cleaning: "caution", reserved: "progress", out_of_service: "inactive" };

type Ward = { id: string; name: string; type: string; gender: string; floor: string | null; is_active: boolean };
type Bed = { id: string; ward_id: string; label: string; bed_class: string; daily_rate: number; status: string; has_oxygen: boolean; has_ventilator: boolean };

function useWards() {
  return useQuery({ queryKey: ["wards"], queryFn: async () => {
    const { data, error } = await supabase.from("wards" as never).select("*").order("name");
    if (error) throw error; return (data ?? []) as unknown as Ward[];
  } });
}
function useBeds() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel("beds-setup").on("postgres_changes", { event: "*", schema: "public", table: "beds" }, () => qc.invalidateQueries({ queryKey: ["beds"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  return useQuery({ queryKey: ["beds"], queryFn: async () => {
    const { data, error } = await supabase.from("beds" as never).select("*").order("label");
    if (error) throw error; return ((data ?? []) as unknown as Bed[]).map((b) => ({ ...b, daily_rate: Number(b.daily_rate) }));
  } });
}

function WardSetupPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin") || hasRole("admin");
  const wards = useWards();
  const beds = useBeds();
  const [sel, setSel] = useState<string | null>(null);
  const [wardForm, setWardForm] = useState<Ward | "new" | null>(null);
  const [bedForm, setBedForm] = useState<Bed | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const list = wards.data ?? [];
  const current = list.find((w) => w.id === sel) ?? list[0] ?? null;
  const wardBeds = (beds.data ?? []).filter((b) => b.ward_id === current?.id);

  const columns: Column<Bed>[] = [
    { key: "label", header: t("wd.label"), sortable: true, render: (b) => <Ltr className="font-mono font-semibold">{b.label}</Ltr> },
    { key: "bed_class", header: t("wd.class"), render: (b) => t(`wd.types.${b.bed_class}`, b.bed_class) },
    { key: "daily_rate", header: t("wd.rate"), numeric: true, sortable: true, render: (b) => <Ltr>{b.daily_rate.toLocaleString("en-PK")}</Ltr> },
    { key: "status", header: t("wd.status"), render: (b) => <StatusChip status={STATUS_TONE[b.status] ?? "inactive"}>{t(`wd.statuses.${b.status}`)}</StatusChip> },
    { key: "has_oxygen", header: "", render: (b) => (
      <span className="flex gap-2 text-muted-foreground">
        {b.has_oxygen && <span className="inline-flex items-center gap-1 text-xs"><Wind className="size-3.5" />{t("wd.oxygen")}</span>}
        {b.has_ventilator && <span className="inline-flex items-center gap-1 text-xs"><Activity className="size-3.5" />{t("wd.ventilator")}</span>}
      </span>) },
  ];
  if (canEdit) columns.push({ key: "id", header: "", render: (b) => <Button size="sm" variant="ghost" onClick={() => setBedForm(b)}>{t("wd.edit")}</Button> });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("wd.intro")}</p>
        {canEdit && <Button onClick={() => setWardForm("new")}><Plus className="size-4" />{t("wd.addWard")}</Button>}
      </div>
      {wards.isLoading ? <Skeleton className="h-64" /> : list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{t("wd.noWards")}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            {list.map((w) => {
              const bs = (beds.data ?? []).filter((b) => b.ward_id === w.id);
              const free = bs.filter((b) => b.status === "free").length;
              return (
                <button key={w.id} onClick={() => setSel(w.id)} className={cn("w-full rounded-lg border bg-card p-3 text-start transition-colors hover:bg-accent", current?.id === w.id && "border-primary ring-1 ring-primary", !w.is_active && "opacity-60")}>
                  <div className="font-medium">{w.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t(`wd.types.${w.type}`)} · {t(`wd.genders.${w.gender}`)}{w.floor ? <> · <Layers className="inline size-3" /> <Ltr>{w.floor}</Ltr></> : null}
                  </div>
                  <div className="mt-1 text-xs"><Ltr>{bs.length}</Ltr> {t("wd.beds")} · <Ltr>{free}</Ltr> {t("wd.free")}</div>
                </button>
              );
            })}
          </div>
          {current && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{current.name}</h2>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setWardForm(current)}>{t("wd.editWard")}</Button>
                    <Button variant="outline" size="sm" onClick={() => setBulk(true)}>{t("wd.bulk")}</Button>
                    <Button size="sm" onClick={() => setBedForm("new")}><Plus className="size-4" />{t("wd.addBed")}</Button>
                  </div>
                )}
              </div>
              {beds.isLoading ? <Skeleton className="h-48" /> : (
                <DataTable rows={wardBeds} columns={columns} searchKeys={["label"]}
                  filters={[{ key: "status", label: t("wd.status"), options: BED_STATUSES.map((v) => ({ value: v, label: t(`wd.statuses.${v}`) })) }]} />
              )}
            </div>
          )}
        </div>
      )}
      {wardForm && <WardForm key={wardForm === "new" ? "new" : wardForm.id} target={wardForm} onClose={() => setWardForm(null)} onSaved={(id) => setSel(id)} />}
      {bedForm && current && <BedForm key={bedForm === "new" ? "new" : bedForm.id} ward={current} target={bedForm} onClose={() => setBedForm(null)} />}
      {bulk && current && <BulkForm ward={current} onClose={() => setBulk(false)} />}
    </div>
  );
}

function Footer({ onClose, onSave, busy }: { onClose: () => void; onSave: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={onSave} disabled={busy}>{t("wd.save")}</Button></div>;
}
function Pick({ label, value, options, onChange, prefix }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void; prefix: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5"><Label>{label}</Label>
      <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((v) => <SelectItem key={v} value={v}>{t(`${prefix}.${v}`)}</SelectItem>)}</SelectContent></Select></div>
  );
}

function WardForm({ target, onClose, onSaved }: { target: Ward | "new"; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const x = target === "new" ? null : target;
  const [f, setF] = useState({ name: x?.name ?? "", type: x?.type ?? "general", gender: x?.gender ?? "any", floor: x?.floor ?? "", is_active: x?.is_active ?? true });
  const save = useEdgeFunction("upsert-ward", { invalidate: [["wards"]], successMessage: t("wd.saved") });
  const submit = async () => {
    if (f.name.trim().length < 2) { toast.error(t("wd.required")); return; }
    try { const r = await save.mutateAsync({ id: x?.id, ...f }) as { data?: { id: string } }; if (r?.data?.id) onSaved(r.data.id); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={x ? t("wd.editWard") : t("wd.addWard")} footer={<Footer onClose={onClose} onSave={submit} busy={save.isPending} />}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="w-name">{t("wd.name")}</Label><Input id="w-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <Pick label={t("wd.type")} value={f.type} options={WARD_TYPES} prefix="wd.types" onChange={(v) => setF({ ...f, type: v })} />
        <Pick label={t("wd.gender")} value={f.gender} options={WARD_GENDERS} prefix="wd.genders" onChange={(v) => setF({ ...f, gender: v })} />
        <div className="space-y-1.5"><Label htmlFor="w-floor">{t("wd.floor")}</Label><Input id="w-floor" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} /></div>
        <div className="flex items-center justify-between"><Label htmlFor="w-active">{t("wd.active")}</Label><Switch id="w-active" checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /></div>
      </div>
    </SidePanel>
  );
}

function BedForm({ ward, target, onClose }: { ward: Ward; target: Bed | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const x = target === "new" ? null : target;
  const [f, setF] = useState({ label: x?.label ?? "", bed_class: x?.bed_class ?? ward.type, daily_rate: x ? String(x.daily_rate) : "", status: x?.status ?? "free", has_oxygen: x?.has_oxygen ?? false, has_ventilator: x?.has_ventilator ?? false });
  const save = useEdgeFunction("upsert-bed", { invalidate: [["beds"]], successMessage: t("wd.saved") });
  const occupied = x?.status === "occupied";
  const submit = async () => {
    if (!f.label.trim()) { toast.error(t("wd.required")); return; }
    try { await save.mutateAsync({ id: x?.id, ward_id: ward.id, ...f, daily_rate: Number(f.daily_rate || 0) }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={x ? t("wd.editBed") : t("wd.addBed")} footer={<Footer onClose={onClose} onSave={submit} busy={save.isPending} />}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="b-label">{t("wd.label")}</Label><Input id="b-label" dir="ltr" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <Pick label={t("wd.class")} value={f.bed_class} options={WARD_TYPES} prefix="wd.types" onChange={(v) => setF({ ...f, bed_class: v })} />
        <div className="space-y-1.5"><Label htmlFor="b-rate">{t("wd.rate")}</Label><Input id="b-rate" dir="ltr" inputMode="decimal" value={f.daily_rate} onChange={(e) => setF({ ...f, daily_rate: e.target.value })} /></div>
        {!occupied && <Pick label={t("wd.status")} value={f.status} options={BED_STATUSES.filter((s) => s !== "occupied")} prefix="wd.statuses" onChange={(v) => setF({ ...f, status: v })} />}
        <div className="flex items-center justify-between"><Label htmlFor="b-o2">{t("wd.oxygen")}</Label><Switch id="b-o2" checked={f.has_oxygen} onCheckedChange={(v) => setF({ ...f, has_oxygen: v })} /></div>
        <div className="flex items-center justify-between"><Label htmlFor="b-vent">{t("wd.ventilator")}</Label><Switch id="b-vent" checked={f.has_ventilator} onCheckedChange={(v) => setF({ ...f, has_ventilator: v })} /></div>
      </div>
    </SidePanel>
  );
}

function BulkForm({ ward, onClose }: { ward: Ward; onClose: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ prefix: "A", from: "1", to: "20", bed_class: ward.type, daily_rate: "", has_oxygen: false, has_ventilator: false });
  const save = useEdgeFunction("bulk-create-beds", { invalidate: [["beds"]], successMessage: t("wd.saved") });
  const from = Number(f.from), to = Number(f.to);
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to - from < 200;
  const submit = async () => {
    if (!valid) { toast.error(t("wd.required")); return; }
    try { await save.mutateAsync({ ward_id: ward.id, ...f, from, to, daily_rate: Number(f.daily_rate || 0) }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={t("wd.bulk")} footer={<Footer onClose={onClose} onSave={submit} busy={save.isPending} />}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5"><Label htmlFor="bk-p">{t("wd.prefix")}</Label><Input id="bk-p" dir="ltr" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="bk-f">{t("wd.from")}</Label><Input id="bk-f" dir="ltr" inputMode="numeric" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="bk-t">{t("wd.to")}</Label><Input id="bk-t" dir="ltr" inputMode="numeric" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        </div>
        {valid && <p className="text-sm text-muted-foreground">{t("wd.preview")}: <Ltr className="font-mono">{f.prefix.trim()}{from} – {f.prefix.trim()}{to}</Ltr> (<Ltr>{to - from + 1}</Ltr>)</p>}
        <Pick label={t("wd.class")} value={f.bed_class} options={WARD_TYPES} prefix="wd.types" onChange={(v) => setF({ ...f, bed_class: v })} />
        <div className="space-y-1.5"><Label htmlFor="bk-r">{t("wd.rate")}</Label><Input id="bk-r" dir="ltr" inputMode="decimal" value={f.daily_rate} onChange={(e) => setF({ ...f, daily_rate: e.target.value })} /></div>
        <div className="flex items-center justify-between"><Label htmlFor="bk-o2">{t("wd.oxygen")}</Label><Switch id="bk-o2" checked={f.has_oxygen} onCheckedChange={(v) => setF({ ...f, has_oxygen: v })} /></div>
        <div className="flex items-center justify-between"><Label htmlFor="bk-v">{t("wd.ventilator")}</Label><Switch id="bk-v" checked={f.has_ventilator} onCheckedChange={(v) => setF({ ...f, has_ventilator: v })} /></div>
      </div>
    </SidePanel>
  );
}
