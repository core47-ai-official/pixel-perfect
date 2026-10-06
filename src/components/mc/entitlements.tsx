import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CreditCard, Plus } from "lucide-react";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { formatPkr } from "@/lib/patient-summary";

// New tables are not in the generated types until they refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface Programme { id: string; name: string; type: "health_card" | "panel" | "corporate"; rules: Record<string, unknown>; is_active: boolean }
export interface Entitlement {
  id: string; patient_id: string; programme_id: string; card_no: string; valid_until: string | null; limit_amount: number; used_amount: number;
  remaining: number; valid: boolean; is_active: boolean; programme: { id: string; name: string; type: string } | null;
}

export const ENT_INVALIDATE = ["entitlements", "invoices"];

export function useProgrammes() {
  return useQuery({ queryKey: ["payer-programmes"], queryFn: async () => {
    const { data, error } = await db.from("payer_programmes").select("id, name, type, rules, is_active").order("name");
    if (error) throw error; return (data ?? []) as Programme[];
  } });
}

export function usePatientEntitlements(patientId: string) {
  return useQuery({ queryKey: ["entitlements", patientId], retry: false,
    queryFn: () => callEdgeFunction<Entitlement[]>("check-entitlement", { patient_id: patientId }) });
}

const hasRole = (roles: string[], list: string[]) => roles.some((r) => list.includes(r));

/** Patient profile: health cards / panels with limit, used and remaining. */
export function EntitlementsSection({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useMyContext().context?.roles ?? [];
  const canEdit = hasRole(roles, ["super_admin", "admin", "receptionist"]);
  const q = usePatientEntitlements(patientId);
  const [adding, setAdding] = useState(false);
  const refresh = () => ENT_INVALIDATE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const toggle = async (e: Entitlement) => {
    try { await callEdgeFunction("add-entitlement", { id: e.id, is_active: !e.is_active }); refresh(); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const list = q.data ?? [];
  return (
    <section className="rounded-staff border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><CreditCard className="size-4" />{t("ent.title")}</h3>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-4" />{t("ent.add")}</Button>}
      </div>
      {q.error ? <p className="text-sm text-muted-foreground">{(q.error as { message?: string }).message}</p>
        : list.length === 0 ? <p className="text-sm text-muted-foreground">{q.isLoading ? "…" : t("ent.none")}</p> : (
        <ul className="divide-y">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-48">
                <p className="font-medium">{e.programme?.name} · <span className="text-muted-foreground">{t(`bill.payers.${e.programme?.type}`, e.programme?.type ?? "")}</span></p>
                <p className="text-muted-foreground">{t("ent.card")}: <Ltr>{e.card_no}</Ltr>{e.valid_until && <> · {t("ent.validUntil")} <Ltr>{e.valid_until}</Ltr></>}</p>
              </div>
              <StatusChip status={e.valid ? "ok" : "inactive"}>{t(e.valid ? "ent.valid" : "ent.invalid")}</StatusChip>
              <span className="ms-auto text-end">
                {t("ent.remaining")} <Ltr className="tnum font-semibold">{formatPkr(e.remaining)}</Ltr>
                <span className="block text-xs text-muted-foreground">{t("ent.used")} <Ltr>{formatPkr(Number(e.used_amount))}</Ltr> / <Ltr>{formatPkr(Number(e.limit_amount))}</Ltr></span>
              </span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => toggle(e)}>{t(e.is_active ? "ent.deactivate" : "ent.activate")}</Button>}
            </li>
          ))}
        </ul>
      )}
      <AddEntitlementPanel open={adding} patientId={patientId} onClose={() => setAdding(false)} onDone={refresh} />
    </section>
  );
}

function AddEntitlementPanel({ open, patientId, onClose, onDone }: { open: boolean; patientId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const progs = (useProgrammes().data ?? []).filter((p) => p.is_active);
  const [prog, setProg] = useState(""); const [card, setCard] = useState(""); const [limit, setLimit] = useState(""); const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("add-entitlement", { patient_id: patientId, programme_id: prog, card_no: card, limit_amount: Number(limit), valid_until: until || null });
      toast.success(t("ent.saved")); onDone(); onClose(); setCard(""); setLimit(""); setUntil("");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={open} onOpenChange={(o) => !o && onClose()} title={t("ent.add")}
      footer={<Button disabled={busy || !prog || !card.trim() || !(Number(limit) > 0)} onClick={save}>{t("ent.save")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>{t("ent.programme")}</Label>
          <Select value={prog} onValueChange={setProg}><SelectTrigger><SelectValue placeholder={progs.length ? t("ent.programme") : t("ent.noProgrammes")} /></SelectTrigger>
            <SelectContent>{progs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="ent-card">{t("ent.card")}</Label><Input id="ent-card" dir="ltr" value={card} onChange={(e) => setCard(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ent-limit">{t("ent.limit")}</Label><Input id="ent-limit" dir="ltr" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ent-until">{t("ent.validUntil")}</Label><Input id="ent-until" type="date" dir="ltr" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}

/** On an open bill: who pays (self, welfare, or one of the patient's cards) and the card's remaining limit. */
export function InvoicePayer({ invoice }: { invoice: { id: string; patient_id?: string; payer_type: string; entitlement_id?: string | null; status: string } }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useMyContext().context?.roles ?? [];
  const canEdit = hasRole(roles, ["super_admin", "admin", "receptionist", "cashier"]) && ["open", "partly_paid"].includes(invoice.status);
  const ents = usePatientEntitlements(invoice.patient_id ?? "");
  const list = invoice.patient_id ? ents.data ?? [] : [];
  const current = list.find((e) => e.id === invoice.entitlement_id);
  const value = invoice.entitlement_id ? `ent:${invoice.entitlement_id}` : invoice.payer_type === "welfare" ? "welfare" : "self";
  const change = async (v: string) => {
    try {
      await callEdgeFunction("check-entitlement", v.startsWith("ent:")
        ? { action: "set_invoice_payer", invoice_id: invoice.id, entitlement_id: v.slice(4) }
        : { action: "set_invoice_payer", invoice_id: invoice.id, payer_type: v });
      toast.success(t("ent.payerSaved"));
      ENT_INVALIDATE.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span>{t("bill.payer")}:</span>
      {canEdit ? (
        <Select value={value} onValueChange={change}>
          <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="self">{t("bill.payers.self")}</SelectItem>
            <SelectItem value="welfare">{t("bill.payers.welfare")}</SelectItem>
            {list.filter((e) => e.valid || e.id === invoice.entitlement_id).map((e) => (
              <SelectItem key={e.id} value={`ent:${e.id}`}>{e.programme?.name} · {e.card_no}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="font-medium">{current ? `${current.programme?.name} · ${current.card_no}` : t(`bill.payers.${invoice.payer_type}`, invoice.payer_type)}</span>
      )}
      {current && (
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
          {t(`bill.payers.${current.programme?.type}`, current.programme?.type ?? "")} · {t("ent.remaining")} <Ltr className="tnum font-semibold">{formatPkr(current.remaining)}</Ltr> / <Ltr>{formatPkr(Number(current.limit_amount))}</Ltr>
        </span>
      )}
    </div>
  );
}
