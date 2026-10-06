import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { formatPkr } from "@/lib/patient-summary";
import { useProgrammes, type Programme } from "@/components/mc/entitlements";

export const Route = createFileRoute("/_authenticated/_app/claims")({
  head: () => ({ meta: [
    { title: "Claims & payer programmes — MediCore HMS" },
    { name: "description", content: "Manage health card, panel and corporate programmes and export claims as CSV." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("claims")}>
      <ClaimsPage />
    </RequireRole>
  ),
});

const pkDate = (offsetDays = 0) => new Date(Date.now() + 5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

function ClaimsPage() {
  const { t } = useTranslation();
  const progs = useProgrammes();
  const [edit, setEdit] = useState<Programme | "new" | null>(null);
  const [prog, setProg] = useState(""); const [from, setFrom] = useState(pkDate(-30)); const [to, setTo] = useState(pkDate());
  const [busy, setBusy] = useState(false);
  const list = progs.data ?? [];

  const exportCsv = async () => {
    setBusy(true);
    try {
      const r = await callEdgeFunction<{ csv: string; rows: number; total: number; programme: { name: string } }>("export-claim", { programme_id: prog, from, to });
      if (!r.rows) { toast.info(t("claims.empty")); return; }
      const blob = new Blob(["\ufeff" + r.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `claims-${r.programme.name.replace(/\W+/g, "-")}-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
      toast.success(t("claims.exported", { rows: r.rows, total: formatPkr(r.total) }));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("claims.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("claims.subtitle")}</p>
      </header>

      <section className="space-y-3 rounded-staff border bg-card p-4">
        <h2 className="font-semibold">{t("claims.export")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label>{t("ent.programme")}</Label>
            <Select value={prog} onValueChange={setProg}><SelectTrigger className="w-60"><SelectValue placeholder={t("ent.programme")} /></SelectTrigger>
              <SelectContent>{list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="cl-from">{t("claims.from")}</Label><Input id="cl-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="cl-to">{t("claims.to")}</Label><Input id="cl-to" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button disabled={busy || !prog || !from || !to} onClick={exportCsv}><Download className="size-4" />{t("claims.download")}</Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("claims.programmes")}</h2>
          <Button variant="outline" onClick={() => setEdit("new")}><Plus className="size-4" />{t("claims.newProgramme")}</Button>
        </div>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">{progs.isLoading ? "…" : t("claims.none")}</p> : (
          <ul className="divide-y rounded-staff border bg-card">
            {list.map((p) => (
              <li key={p.id}><button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-accent/40" onClick={() => setEdit(p)}>
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">{t(`claims.types.${p.type}`)}</span>
                <StatusChip status={p.is_active ? "ok" : "inactive"} className="ms-auto">{t(p.is_active ? "claims.active" : "claims.inactive")}</StatusChip>
              </button></li>
            ))}
          </ul>
        )}
      </section>
      <ProgrammePanel value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ProgrammePanel({ value, onClose }: { value: Programme | "new" | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const p = value && value !== "new" ? value : null;
  const [key, setKey] = useState<string | null>(null);
  const [name, setName] = useState(""); const [type, setType] = useState("health_card"); const [rules, setRules] = useState(""); const [active, setActive] = useState(true);
  const k = value === null ? null : p?.id ?? "new";
  if (k !== key) { setKey(k); setName(p?.name ?? ""); setType(p?.type ?? "health_card"); setRules(p && Object.keys(p.rules ?? {}).length ? JSON.stringify(p.rules, null, 2) : ""); setActive(p?.is_active ?? true); }
  const [busy, setBusy] = useState(false);
  const save = async () => {
    let parsed: unknown = {};
    if (rules.trim()) { try { parsed = JSON.parse(rules); } catch { toast.error(t("claims.rulesBad")); return; } }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { toast.error(t("claims.rulesBad")); return; }
    setBusy(true);
    try {
      await callEdgeFunction("upsert-payer-programme", { id: p?.id, name, type, rules: parsed, is_active: active });
      toast.success(t("claims.saved")); qc.invalidateQueries({ queryKey: ["payer-programmes"] }); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={value !== null} onOpenChange={(o) => !o && onClose()} title={p ? t("claims.editProgramme") : t("claims.newProgramme")}
      footer={<Button disabled={busy || !name.trim()} onClick={save}>{t("claims.save")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="pp-name">{t("claims.name")}</Label><Input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>{t("claims.type")}</Label>
          <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["health_card", "panel", "corporate"].map((x) => <SelectItem key={x} value={x}>{t(`claims.types.${x}`)}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="pp-rules">{t("claims.rules")}</Label><Textarea id="pp-rules" dir="ltr" className="font-mono text-xs" rows={6} value={rules} onChange={(e) => setRules(e.target.value)} placeholder='{"covers": ["ipd"], "co_pay_percent": 0}' /></div>
        <div className="flex items-center gap-2"><Switch id="pp-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="pp-active">{t("claims.active")}</Label></div>
      </div>
    </SidePanel>
  );
}
