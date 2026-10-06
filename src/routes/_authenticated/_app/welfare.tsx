import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HandCoins, HandHeart, Plus, Printer } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { formatPkr } from "@/lib/patient-summary";

export const Route = createFileRoute("/_authenticated/_app/welfare")({
  head: () => ({ meta: [
    { title: "Welfare & zakat — MediCore HMS" },
    { name: "description", content: "Welfare and zakat fund balances, donations, donor receipts and bill support." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("welfare")}>
      <WelfarePage />
    </RequireRole>
  ),
});

// New tables are not in the generated types until they refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Fund { id: string; name: string; type: "zakat" | "charity" | "other"; balance: number; is_active: boolean }
interface Tx {
  id: string; fund_id: string; type: "donation" | "allocation"; status: string; amount: number; donor_name: string | null; donor_phone: string | null;
  receipt_no: string | null; note: string | null; decision_note: string | null; created_at: string; decided_at: string | null;
  requested_by: string | null; approved_by: string | null; invoice_id: string | null;
  patient: { full_name: string; mrn: string } | null; invoice: { invoice_no: string; balance: number } | null;
  fund_name: string; requester: string; approver: string;
}
interface Bill { id: string; invoice_no: string; balance: number; patient: { full_name: string; mrn: string } | null }

const fmt = (s: string) => { const d = new Date(s); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const TONE: Record<string, "ok" | "warning" | "urgent" | "inactive"> = { approved: "ok", pending: "warning", processing: "warning", rejected: "urgent" };

function useWelfare() {
  const funds = useQuery({ queryKey: ["welfare-funds"], queryFn: async () => {
    const { data, error } = await db.from("welfare_funds").select("id, name, type, balance, is_active").order("name");
    if (error) throw error; return (data ?? []) as Fund[];
  } });
  const txs = useQuery({ queryKey: ["welfare-tx"], queryFn: async () => {
    const { data, error } = await db.from("welfare_transactions")
      .select("*, patient:patients(full_name, mrn), invoice:invoices(invoice_no, balance)").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const rows = (data ?? []) as Tx[];
    const ids = [...new Set(rows.flatMap((r) => [r.requested_by, r.approved_by]).filter(Boolean))] as string[];
    const { data: profs } = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const nm = new Map<string, string>((profs ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
    return rows.map((r) => ({ ...r, requester: r.requested_by ? nm.get(r.requested_by) ?? "—" : "—", approver: r.approved_by ? nm.get(r.approved_by) ?? "—" : "—" }));
  } });
  return { funds, txs };
}

function WelfarePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useMyContext().data?.roles ?? [];
  const isAdmin = (roles ?? []).some((r) => r === "admin" || r === "super_admin");
  const { funds, txs } = useWelfare();
  const [fundFilter, setFundFilter] = useState("all");
  const [fundPanel, setFundPanel] = useState<Fund | "new" | null>(null);
  const [donating, setDonating] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<Tx | null>(null);
  const [receipt, setReceipt] = useState<Tx | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["welfare-funds"] }); qc.invalidateQueries({ queryKey: ["welfare-tx"] }); qc.invalidateQueries({ queryKey: ["unpaid-report"] }); };

  const fundList = funds.data ?? [];
  const fname = new Map(fundList.map((f) => [f.id, f.name]));
  const all = (txs.data ?? []).map((r) => ({ ...r, fund_name: fname.get(r.fund_id) ?? "—" }));
  const pending = all.filter((r) => r.status === "pending");
  const ledger = all.filter((r) => r.status !== "pending" && (fundFilter === "all" || r.fund_id === fundFilter));

  const cols: Column<Tx>[] = [
    { key: "created_at", header: t("welfare.date"), sortable: true, render: (r) => <Ltr>{fmt(r.decided_at ?? r.created_at)}</Ltr> },
    { key: "fund_name", header: t("welfare.fund") },
    { key: "type", header: t("welfare.kind"), render: (r) => t(`welfare.kinds.${r.type}`) },
    { key: "donor_name", header: `${t("welfare.donor")} / ${t("welfare.patient")}`, render: (r) => r.type === "donation" ? r.donor_name : r.patient ? <span>{r.patient.full_name} · <Ltr>{r.patient.mrn}</Ltr>{r.invoice && <> · <Ltr>{r.invoice.invoice_no}</Ltr></>}</span> : "—" },
    { key: "amount", header: t("welfare.amount"), numeric: true, render: (r) => <Ltr className={r.type === "donation" ? "text-ok-fg" : ""}>{r.type === "donation" ? "+" : "−"}{formatPkr(Number(r.amount))}</Ltr> },
    { key: "status", header: t("welfare.status"), render: (r) => <StatusChip status={TONE[r.status] ?? "inactive"}>{t(`welfare.statuses.${r.status}`)}</StatusChip> },
    { key: "approver", header: t("welfare.approvedBy") },
    { key: "receipt_no", header: t("welfare.receipt"), render: (r) => r.type === "donation" && r.receipt_no ? <Button size="sm" variant="ghost" onClick={() => setReceipt(r)}><Printer className="size-4" /><Ltr>{r.receipt_no}</Ltr></Button> : r.receipt_no ? <Ltr>{r.receipt_no}</Ltr> : "—" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("welfare.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("welfare.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRequesting(true)} disabled={!fundList.some((f) => f.is_active)}><HandHeart className="size-4" />{t("welfare.requestSupport")}</Button>
          {isAdmin && <Button variant="outline" onClick={() => setFundPanel("new")}><Plus className="size-4" />{t("welfare.newFund")}</Button>}
          {isAdmin && <Button onClick={() => setDonating(true)} disabled={!fundList.some((f) => f.is_active)}><HandCoins className="size-4" />{t("welfare.recordDonation")}</Button>}
        </div>
      </header>

      <section aria-label={t("welfare.funds")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fundList.length === 0 && <p className="text-sm text-muted-foreground">{funds.isLoading ? "…" : t("welfare.noFunds")}</p>}
        {fundList.map((f) => (
          <button key={f.id} type="button" disabled={!isAdmin} onClick={() => setFundPanel(f)}
            className="rounded-lg border bg-card p-4 text-start shadow-sm transition-colors enabled:hover:bg-accent/40 disabled:cursor-default">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{f.name}</span>
              <StatusChip status={f.is_active ? "ok" : "inactive"}>{t(`welfare.types.${f.type}`)}</StatusChip>
            </div>
            <p className="mt-2 text-2xl font-semibold"><Ltr>{formatPkr(Number(f.balance))}</Ltr></p>
            <p className="text-xs text-muted-foreground">{t("welfare.balance")}</p>
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("welfare.pending")} ({pending.length})</h2>
        {pending.length === 0 ? <p className="text-sm text-muted-foreground">{t("welfare.noPending")}</p> : (
          <div className="divide-y rounded-lg border bg-card">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="text-sm">
                  <p className="font-medium">{r.patient?.full_name} · <Ltr>{r.patient?.mrn}</Ltr> · <Ltr>{r.invoice?.invoice_no}</Ltr></p>
                  <p className="text-muted-foreground">{r.fund_name} · <Ltr>{formatPkr(Number(r.amount))}</Ltr> · {t("welfare.requestedBy")}: {r.requester}</p>
                  {r.note && <p className="text-muted-foreground">{r.note}</p>}
                </div>
                {isAdmin && <Button size="sm" onClick={() => setDeciding(r)}>{t("welfare.approve")} / {t("welfare.reject")}</Button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("welfare.ledger")}</h2>
          <Select value={fundFilter} onValueChange={setFundFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("welfare.filterAll")}</SelectItem>
              {fundList.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DataTable rows={ledger} columns={cols} searchKeys={["donor_name", "receipt_no", "fund_name"]} pageSize={15} />
      </section>

      <FundPanel fund={fundPanel} onClose={() => setFundPanel(null)} onDone={refresh} />
      <DonationPanel open={donating} funds={fundList.filter((f) => f.is_active)} onClose={() => setDonating(false)} onDone={(tx) => { refresh(); setReceipt(tx); }} />
      <RequestPanel open={requesting} funds={fundList.filter((f) => f.is_active)} onClose={() => setRequesting(false)} onDone={refresh} />
      <DecidePanel tx={deciding} onClose={() => setDeciding(null)} onDone={refresh} />
      {receipt && <DonorReceipt tx={receipt} fundName={fname.get(receipt.fund_id) ?? ""} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function FundSelect({ funds, value, onChange }: { funds: Fund[]; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label>{t("welfare.fund")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={t("welfare.fund")} /></SelectTrigger>
        <SelectContent>{funds.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} · {formatPkr(Number(f.balance))}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: string, body: unknown, ok: string, after: (d: T) => void) => {
    setBusy(true);
    try { const d = await callEdgeFunction<T>(fn, body); toast.success(ok); after(d); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

function FundPanel({ fund, onClose, onDone }: { fund: Fund | "new" | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const editing = fund && fund !== "new" ? fund : null;
  const [name, setName] = useState(""); const [type, setType] = useState("zakat"); const [active, setActive] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  const k = fund === null ? null : editing?.id ?? "new";
  if (k !== key) { setKey(k); setName(editing?.name ?? ""); setType(editing?.type ?? "zakat"); setActive(editing?.is_active ?? true); }
  const { busy, run } = useSubmit();
  return (
    <SidePanel open={fund !== null} onOpenChange={(o) => !o && onClose()} title={editing ? t("welfare.editFund") : t("welfare.newFund")}
      footer={<Button disabled={busy || !name.trim()} onClick={() => run("record-donation", { action: "save_fund", id: editing?.id, name, type, is_active: active }, t("welfare.saved"), () => { onDone(); onClose(); })}>{t("welfare.save")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="wf-name">{t("welfare.fundName")}</Label><Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>{t("welfare.type")}</Label>
          <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["zakat", "charity", "other"].map((x) => <SelectItem key={x} value={x}>{t(`welfare.types.${x}`)}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="flex items-center gap-2"><Switch id="wf-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="wf-active">{t("welfare.active")}</Label></div>
      </div>
    </SidePanel>
  );
}

function DonationPanel({ open, funds, onClose, onDone }: { open: boolean; funds: Fund[]; onClose: () => void; onDone: (tx: Tx) => void }) {
  const { t } = useTranslation();
  const [fundId, setFundId] = useState(""); const [amount, setAmount] = useState(""); const [donor, setDonor] = useState(""); const [phone, setPhone] = useState(""); const [note, setNote] = useState("");
  const { busy, run } = useSubmit();
  const submit = () => run<{ transaction: Tx }>("record-donation", { fund_id: fundId, amount: Number(amount), donor_name: donor, donor_phone: phone, note }, t("welfare.donationSaved"), (d) => {
    onDone(d.transaction); onClose(); setAmount(""); setDonor(""); setPhone(""); setNote("");
  });
  return (
    <SidePanel open={open} onOpenChange={(o) => !o && onClose()} title={t("welfare.recordDonation")}
      footer={<Button disabled={busy || !fundId || !(Number(amount) > 0) || !donor.trim()} onClick={submit}>{t("welfare.save")}</Button>}>
      <div className="space-y-4">
        <FundSelect funds={funds} value={fundId} onChange={setFundId} />
        <div className="space-y-1.5"><Label htmlFor="wd-amt">{t("welfare.amount")}</Label><Input id="wd-amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wd-donor">{t("welfare.donor")}</Label><Input id="wd-donor" value={donor} onChange={(e) => setDonor(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wd-phone">{t("welfare.donorPhone")}</Label><Input id="wd-phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wd-note">{t("welfare.note")}</Label><Textarea id="wd-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}

function RequestPanel({ open, funds, onClose, onDone }: { open: boolean; funds: Fund[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [fundId, setFundId] = useState(""); const [billNo, setBillNo] = useState(""); const [bill, setBill] = useState<Bill | null>(null);
  const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const { busy, run } = useSubmit();
  const find = async () => {
    const { data } = await db.from("invoices").select("id, invoice_no, balance, status, patient:patients(full_name, mrn)")
      .ilike("invoice_no", billNo.trim()).in("status", ["open", "partly_paid"]).maybeSingle();
    if (!data) { setBill(null); toast.error(t("welfare.billNotFound")); return; }
    setBill(data as Bill); setAmount(String(data.balance));
  };
  return (
    <SidePanel open={open} onOpenChange={(o) => !o && onClose()} title={t("welfare.requestSupport")}
      footer={<Button disabled={busy || !bill || !fundId || !(Number(amount) > 0) || !note.trim()} onClick={() => run("request-welfare-support", { fund_id: fundId, invoice_id: bill?.id, amount: Number(amount), note }, t("welfare.requestSent"), () => { onDone(); onClose(); setBill(null); setBillNo(""); setNote(""); })}>{t("welfare.save")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="wr-bill">{t("welfare.billSearch")}</Label>
          <div className="flex gap-2"><Input id="wr-bill" dir="ltr" value={billNo} onChange={(e) => setBillNo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} />
            <Button variant="outline" onClick={find} disabled={!billNo.trim()}>{t("welfare.findBill")}</Button></div>
        </div>
        {bill && <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{bill.patient?.full_name} · <Ltr>{bill.patient?.mrn}</Ltr></p>
          <p>{t("welfare.billBalance")}: <Ltr>{formatPkr(Number(bill.balance))}</Ltr></p>
        </div>}
        <FundSelect funds={funds} value={fundId} onChange={setFundId} />
        <div className="space-y-1.5"><Label htmlFor="wr-amt">{t("welfare.amount")}</Label><Input id="wr-amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wr-note">{t("welfare.reason")}</Label><Textarea id="wr-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}

function DecidePanel({ tx, onClose, onDone }: { tx: Tx | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [key, setKey] = useState<string | null>(null);
  if ((tx?.id ?? null) !== key) { setKey(tx?.id ?? null); setAmount(tx ? String(tx.amount) : ""); setNote(""); }
  const { busy, run } = useSubmit();
  const go = (decision: "approve" | "reject") => run("decide-welfare-support", { id: tx?.id, decision, amount: Number(amount), decision_note: note },
    t(decision === "approve" ? "welfare.approved" : "welfare.rejected"), () => { onDone(); onClose(); });
  return (
    <SidePanel open={!!tx} onOpenChange={(o) => !o && onClose()} title={`${t("welfare.approve")} / ${t("welfare.reject")}`}
      footer={<div className="flex gap-2">
        <Button variant="outline" disabled={busy || !note.trim()} onClick={() => go("reject")}>{t("welfare.reject")}</Button>
        <Button disabled={busy || !(Number(amount) > 0)} onClick={() => go("approve")}>{t("welfare.approve")}</Button></div>}>
      {tx && <div className="space-y-4 text-sm">
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="font-medium">{tx.patient?.full_name} · <Ltr>{tx.patient?.mrn}</Ltr></p>
          <p>{t("welfare.bill")}: <Ltr>{tx.invoice?.invoice_no}</Ltr> · {t("welfare.billBalance")}: <Ltr>{formatPkr(Number(tx.invoice?.balance ?? 0))}</Ltr></p>
          <p>{t("welfare.fund")}: {tx.fund_name}</p>
          <p>{t("welfare.requestedBy")}: {tx.requester}</p>
          {tx.note && <p className="mt-1">{tx.note}</p>}
        </div>
        <div className="space-y-1.5"><Label htmlFor="wx-amt">{t("welfare.approveAmount")}</Label><Input id="wx-amt" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wx-note">{t("welfare.decisionNote")}</Label><Textarea id="wx-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>}
    </SidePanel>
  );
}

function DonorReceipt({ tx, fundName, onClose }: { tx: Tx; fundName: string; onClose: () => void }) {
  const brand = usePrintBrand();
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="thermal80" printLanguage="ur"
      qrValue={tx.receipt_no ?? tx.id} job={{ documentType: "welfare_donation_receipt", documentId: tx.receipt_no ?? tx.id }}>
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt("welfare.print.title")}</p>
          <p className="text-center text-lg font-bold"><Ltr>{tx.receipt_no}</Ltr></p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>{pt("welfare.print.date")}</span><span className="text-end"><Ltr>{fmt(tx.created_at)}</Ltr></span>
            <span>{pt("welfare.print.donor")}</span><span className="text-end">{tx.donor_name}</span>
            <span>{pt("welfare.print.fund")}</span><span className="text-end">{fundName}</span>
          </div>
          <div className="mc-rule grid grid-cols-2 gap-x-2 border-t pt-1 text-base font-bold">
            <span>{pt("welfare.print.amount")}</span><span className="text-end"><Ltr>{formatPkr(Number(tx.amount))}</Ltr></span>
          </div>
          <p className="mc-rule border-t pt-1 text-center text-xs">{pt("welfare.print.thanks")}</p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
