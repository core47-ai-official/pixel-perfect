import { useMyOpenShift } from "@/lib/shifts";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BadgePercent, Banknote, PiggyBank, Printer, RotateCcw, Search, Undo2 } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { CashReceipt, type ReceiptData } from "@/components/mc/cash-receipt";
import { formatPkr } from "@/lib/patient-summary";
import { usePatientAdmissions } from "@/lib/admissions";
import {
  CASH_INVALIDATE, r2, useBillingInvoices, useInvoicePayments, usePatientDeposits,
  type Payment, type SearchPatient,
} from "@/lib/cash";
import type { Invoice } from "@/components/mc/patient-bills-tab";
import { cn } from "@/lib/utils";
import { useApprovals } from "@/lib/approvals";
import { useInvoicePlan, todayPk, type InstallmentPlan } from "@/lib/installments";
import { RequestApprovalPanel } from "@/components/mc/request-approval-panel";

export const Route = createFileRoute("/_authenticated/_app/billing")({
  validateSearch: (s: Record<string, unknown>): { mode?: "deposit" } => (s["mode"] === "deposit" ? { mode: "deposit" } : {}),
  head: () => ({ meta: [{ title: "Billing counter — MediCore HMS" }, { name: "description", content: "Take cash payments, deposits and refunds, and print receipts." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("billing")}>
      <BillingCounter />
    </RequireRole>
  ),
});

const TONE: Record<Invoice["status"], "warning" | "caution" | "ok" | "inactive"> = { open: "warning", partly_paid: "caution", paid: "ok", waived: "inactive", closed: "inactive" };
type ErrLike = { message?: string };
const errMsg = (e: unknown, fb: string) => (e as ErrLike)?.message || fb;

function BillingCounter() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const { hasRole } = useMyContext();
  const canCash = hasRole("super_admin", "admin", "cashier");
  const isAdmin = hasRole("super_admin", "admin");
  const myShift = useMyOpenShift(canCash);

  // ---- patient search (F2) ----
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [patient, setPatient] = useState<SearchPatient | null>(null);
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); e.stopImmediatePropagation(); searchRef.current?.focus(); searchRef.current?.select(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const results = useQuery({
    queryKey: ["billing-search", debounced], enabled: debounced.length >= 2 && !patient,
    queryFn: () => callEdgeFunction<SearchPatient[]>("search-patients", { q: debounced }),
  });
  const choose = (p: SearchPatient) => { setPatient(p); setQ(""); setInvoiceId(null); setTimeout(() => cashRef.current?.focus(), 50); };

  // ---- bills ----
  const invoices = useBillingInvoices(patient?.id ?? null);
  const [showClosed, setShowClosed] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const list = useMemo(() => (invoices.data ?? []).filter((i) => showClosed || ["open", "partly_paid"].includes(i.status)), [invoices.data, showClosed]);
  useEffect(() => { if (!invoiceId && list[0]) setInvoiceId(list[0].id); }, [list, invoiceId]);
  const invoice = (invoices.data ?? []).find((i) => i.id === invoiceId) ?? null;
  const payments = useInvoicePayments(invoice?.id ?? null);
  const deposits = usePatientDeposits(patient?.id ?? null);
  const available = (deposits.data ?? []).filter((d) => r2(d.amount - d.applied_amount) > 0);

  // ---- cash entry ----
  const cashRef = useRef<HTMLInputElement>(null);
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const balance = invoice ? Number(invoice.balance) : 0;
  const tendered = Number(cash) || 0;
  const toApply = r2(Math.min(tendered, balance));
  const change = r2(Math.max(0, tendered - balance));
  const payable = !!invoice && ["open", "partly_paid"].includes(invoice.status) && balance > 0;

  const refresh = () => CASH_INVALIDATE.forEach((k) => qc.invalidateQueries({ queryKey: k }));

  // ---- receipt (Ctrl+P) ----
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p" && !receiptOpen) {
        e.preventDefault();
        if (receipt) setReceiptOpen(true); else toast.info(t("cash.noReceipt"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [receipt, receiptOpen, t]);
  const ptInfo = patient ? { id: patient.id, full_name: patient.full_name, mrn: patient.mrn, print_language: patient.print_language } : null;

  const takePayment = async () => {
    if (!invoice || !ptInfo || toApply <= 0 || busy) return;
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ payment: Payment; invoice: Invoice; change: number }>("record-payment", { invoice_id: invoice.id, amount: toApply, tendered });
      setReceipt({ kind: "payment", receipt_no: res.payment.receipt_no, amount: res.payment.amount, tendered, change: res.change, balance: Number(res.invoice.balance), invoice_no: invoice.invoice_no, patient: ptInfo, at: res.payment.created_at });
      toast.success(t("cash.paidOk", { change: formatPkr(res.change) }));
      setCash(""); refresh();
    } catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };

  const applyDeposit = async (depositId: string) => {
    if (!invoice || !ptInfo) return;
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ payment: Payment; invoice: Invoice }>("apply-deposit", { deposit_id: depositId, invoice_id: invoice.id });
      setReceipt({ kind: "deposit_applied", receipt_no: res.payment.receipt_no, amount: res.payment.amount, balance: Number(res.invoice.balance), invoice_no: invoice.invoice_no, patient: ptInfo, at: res.payment.created_at });
      toast.success(t("cash.applied")); refresh();
    } catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };

  // ---- deposit panel ----
  const [depOpen, setDepOpen] = useState(mode === "deposit");
  useEffect(() => { if (mode === "deposit") setDepOpen(true); }, [mode]);
  const closeDep = (o: boolean) => { setDepOpen(o); if (!o && mode) void navigate({ to: "/billing", search: {} }); };

  // ---- refund / reversal panels ----
  const [refundOpen, setRefundOpen] = useState(false);
  const [reversal, setReversal] = useState<Payment | null>(null);
  const pendingApprovals = useApprovals({ status: "pending" });
  const billApprovals = useApprovals({ status: "pending", invoiceId: invoice?.id ?? null });
  const [apvOpen, setApvOpen] = useState(false);
  const plan = useInvoicePlan(invoice?.id ?? null);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {canCash && myShift.isSuccess && !myShift.data && (
        <Banner tone="warning" title={t("shift.needOpen")}>
          {t("shift.needOpenBody")} <Link to="/cash-register" className="font-medium underline">{t("shift.goRegister")}</Link>
        </Banner>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("cash.title")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!receipt} onClick={() => setReceiptOpen(true)}><Printer /> {t("cash.reprint")} <kbd className="ms-1 text-[10px] text-muted-foreground">Ctrl+P</kbd></Button>
          {canCash && <Button variant="secondary" onClick={() => setDepOpen(true)}><PiggyBank /> {t("cash.newDeposit")}</Button>}
        </div>
      </div>

      {!canCash && <Banner title={t("cash.viewOnly")} />}

      {isAdmin && (pendingApprovals.data?.length ?? 0) > 0 && (
        <Banner title={t("apv.waitingBanner", { n: pendingApprovals.data!.length })}>
          <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/approvals" })}>{t("apv.openInbox")}</Button>
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Patient + bills */}
        <section className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef} value={q} className="ps-9 pe-10" placeholder={t("cash.searchPh")} aria-label={t("cash.searchPh")}
              onChange={(e) => { setQ(e.target.value); setPatient(null); setActive(0); }}
              onKeyDown={(e) => {
                const rows = results.data ?? [];
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === "Enter" && rows[active]) { e.preventDefault(); choose(rows[active]); }
              }}
            />
            <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">F2</kbd>
          </div>
          {!patient && debounced.length >= 2 && (
            <ul className="rounded-staff border bg-surface">
              {results.isLoading && <li className="p-3 text-sm text-muted-foreground">{t("cash.searching")}</li>}
              {results.isError && <li className="p-3 text-sm text-urgent-fg">{t("cash.searchError")}</li>}
              {results.data?.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t("cash.noPatients")}</li>}
              {results.data?.map((p, i) => (
                <li key={p.id}>
                  <button type="button" onClick={() => choose(p)} className={cn("w-full p-3 text-start text-sm hover:bg-accent", i === active && "bg-accent")}>
                    <span className="font-medium">{p.full_name}</span>{" "}
                    <span className="text-muted-foreground"><Ltr>{p.mrn}</Ltr>{p.phone && <> · <Ltr>{p.phone}</Ltr></>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {patient && (
            <div className="rounded-staff border bg-surface p-3">
              <p className="font-semibold">{patient.full_name}</p>
              <p className="text-sm text-muted-foreground"><Ltr>{patient.mrn}</Ltr>{patient.age != null && <> · <Ltr>{patient.age}</Ltr></>}</p>
            </div>
          )}

          {patient && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{t("cash.bills")}</h2>
                <Button size="sm" variant="ghost" onClick={() => setShowClosed((s) => !s)}>{showClosed ? t("cash.hideClosed") : t("cash.showClosed")}</Button>
              </div>
              {invoices.isError && <Banner title={t("cash.billsError")} />}
              {invoices.data && list.length === 0 && <p className="text-sm text-muted-foreground">{t("cash.noBills")}</p>}
              {list.map((i) => (
                <button key={i.id} type="button" onClick={() => { setInvoiceId(i.id); setCash(""); }}
                  className={cn("w-full rounded-staff border bg-surface p-3 text-start", i.id === invoiceId && "border-primary ring-1 ring-primary")}>
                  <div className="flex items-center justify-between gap-2">
                    <Ltr className="font-medium">{i.invoice_no}</Ltr>
                    <StatusChip status={TONE[i.status]}>{t(`bill.statuses.${i.status}`)}</StatusChip>
                  </div>
                  <p className={cn("mt-1 text-sm", Number(i.balance) > 0 ? "font-semibold text-urgent-fg" : "text-muted-foreground")}>
                    {t("cash.balance")}: <Ltr>{formatPkr(i.balance)}</Ltr>
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Selected bill */}
        <section className="space-y-4">
          {!patient && <EmptyState icon={Banknote} title={t("cash.startTitle")} description={t("cash.startBody")} />}
          {invoice && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["total", "discount", "paid", "balance"] as const).map((k) => (
                  <div key={k} className="rounded-staff border bg-surface p-3">
                    <p className="text-xs text-muted-foreground">{t(`cash.${k}`)}</p>
                    <p className={cn("text-lg font-semibold", k === "balance" && balance > 0 && "text-urgent-fg")}><Ltr>{formatPkr(invoice[k])}</Ltr></p>
                  </div>
                ))}
              </div>

              {plan.data && <PlanCard plan={plan.data} />}

              {payable && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setApvOpen(true)}><BadgePercent /> {t("apv.requestBtn")}</Button>
                  {billApprovals.data?.filter((a) => a.invoice_id === invoice.id).map((a) => (
                    <StatusChip key={a.id} status="caution">{t(`apv.type.${a.type}`)} · <Ltr>{formatPkr(a.amount)}</Ltr> · {t("apv.status.pending")}</StatusChip>
                  ))}
                </div>
              )}

              {canCash && payable && (
                <form className="space-y-3 rounded-staff border bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void takePayment(); }}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="cash">{t("cash.received")}</Label>
                      <Input id="cash" ref={cashRef} inputMode="decimal" dir="ltr" className="h-14 text-2xl" value={cash}
                        onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t("cash.toApply")}</p>
                      <p className="flex h-14 items-center text-2xl font-semibold"><Ltr>{formatPkr(toApply)}</Ltr></p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t("cash.change")}</p>
                      <p className={cn("flex h-14 items-center text-2xl font-bold", change > 0 && "text-ok-fg")}><Ltr>{formatPkr(change)}</Ltr></p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setCash(String(balance))}>{t("cash.exact")}</Button>
                    <Button type="submit" disabled={busy || toApply <= 0}><Banknote /> {t("cash.take", { amount: formatPkr(toApply) })}</Button>
                  </div>
                </form>
              )}

              {canCash && payable && available.length > 0 && (
                <div className="rounded-staff border bg-surface p-3">
                  <h3 className="mb-2 font-semibold">{t("cash.depositsAvailable")}</h3>
                  <ul className="space-y-2">
                    {available.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                        <span><Ltr>{d.receipt_no}</Ltr> · {t("cash.left")}: <Ltr>{formatPkr(r2(d.amount - d.applied_amount))}</Ltr></span>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyDeposit(d.id)}>{t("cash.apply")}</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-staff border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{t("cash.history")}</h3>
                  {canCash && Number(invoice.paid) > 0 && <Button size="sm" variant="outline" onClick={() => setRefundOpen(true)}><RotateCcw /> {t("cash.refund")}</Button>}
                </div>
                {payments.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("cash.noPayments")}</p>}
                <ul className="divide-y text-sm">
                  {payments.data?.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <Ltr className="font-medium">{p.receipt_no}</Ltr> · {t(`cash.kind.${p.kind}`)} ·{" "}
                        <Ltr className={cn(p.amount < 0 && "text-urgent-fg")}>{formatPkr(p.amount)}</Ltr>
                        {p.reason && <span className="text-muted-foreground"> — {p.reason}</span>}
                        {p.reversed_by_id && <StatusChip status="inactive" className="ms-2">{t("cash.reversed")}</StatusChip>}
                        {!p.reversed_by_id && p.reversal_requested_at && <StatusChip status="caution" className="ms-2">{t("cash.rev.pending")}</StatusChip>}
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { if (ptInfo) { setReceipt({ kind: p.kind === "refund" || p.kind === "reversal" ? "refund" : p.kind === "deposit_applied" ? "deposit_applied" : "payment", receipt_no: p.receipt_no, amount: p.amount, tendered: p.tendered, change: p.tendered != null ? r2(p.tendered - p.amount) : null, invoice_no: invoice.invoice_no, reason: p.reason, patient: ptInfo, at: p.created_at }); setReceiptOpen(true); } }}>
                          <Printer />
                        </Button>
                        {canCash && (p.kind === "payment" || p.kind === "deposit_applied") && !p.reversed_by_id && !p.reversal_requested_at && (
                          <Button size="sm" variant="ghost" onClick={() => setReversal(p)}><Undo2 /> {t("cash.rev.request")}</Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>

      {receipt && <CashReceipt data={receipt} open={receiptOpen} onOpenChange={setReceiptOpen} />}
      <DepositPanel open={depOpen} onOpenChange={closeDep} patient={patient} onDone={(r) => { setReceipt(r); setReceiptOpen(true); refresh(); }} />
      {invoice && ptInfo && (
        <RefundPanel open={refundOpen} onOpenChange={setRefundOpen} invoice={invoice}
          onDone={(r) => { setReceipt({ ...r, patient: ptInfo }); setReceiptOpen(true); refresh(); }} />
      )}
      {invoice && <RequestApprovalPanel open={apvOpen} onOpenChange={setApvOpen} invoice={invoice} onDone={() => { refresh(); void qc.invalidateQueries({ queryKey: ["approvals"] }); }} />}
      <ReversalPanel payment={reversal} onClose={() => setReversal(null)} onDone={refresh} />
    </div>
  );
}

function DepositPanel({ open, onOpenChange, patient, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; patient: SearchPatient | null; onDone: (r: ReceiptData) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [note, setNote] = useState("");
  const [admissionId, setAdmissionId] = useState("");
  const [busy, setBusy] = useState(false);
  const admissions = usePatientAdmissions(patient?.id ?? "");
  const activeAdm = ((admissions.data ?? []) as { id: string; status: string; admitted_at: string }[]).filter((a) => a.status === "admitted");
  useEffect(() => { if (open) { setAmount(""); setTendered(""); setNote(""); setAdmissionId(activeAdm[0]?.id ?? ""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = Number(amount) || 0;
  const tnd = Number(tendered) || amt;
  const save = async () => {
    if (!patient || amt <= 0) return;
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ deposit: { receipt_no: string; amount: number; created_at: string }; change: number }>("record-deposit", {
        patient_id: patient.id, amount: amt, tendered: tnd, note, admission_id: admissionId || null,
      });
      onDone({ kind: "deposit", receipt_no: res.deposit.receipt_no, amount: res.deposit.amount, tendered: tnd, change: res.change, patient: { id: patient.id, full_name: patient.full_name, mrn: patient.mrn, print_language: patient.print_language }, at: res.deposit.created_at });
      toast.success(t("cash.depositSaved")); onOpenChange(false);
    } catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("cash.newDeposit")}
      footer={<Button disabled={!patient || amt <= 0 || tnd < amt || busy} onClick={() => void save()}><PiggyBank /> {t("cash.saveDeposit")}</Button>}>
      {!patient ? <p className="text-sm text-muted-foreground">{t("cash.pickPatientFirst")}</p> : (
        <div className="space-y-4">
          <p className="font-medium">{patient.full_name} · <Ltr>{patient.mrn}</Ltr></p>
          {activeAdm.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="adm">{t("cash.forAdmission")}</Label>
              <select id="adm" className="h-10 w-full rounded-staff border bg-surface px-3" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}>
                <option value="">{t("cash.noAdmission")}</option>
                {activeAdm.map((a) => <option key={a.id} value={a.id}>{new Date(a.admitted_at).toLocaleDateString()}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="damt">{t("cash.depositAmount")}</Label>
            <Input id="damt" dir="ltr" inputMode="decimal" className="h-12 text-xl" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></div>
          <div className="space-y-1"><Label htmlFor="dtnd">{t("cash.received")}</Label>
            <Input id="dtnd" dir="ltr" inputMode="decimal" className="h-12 text-xl" value={tendered} placeholder={amount} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} /></div>
          <p className="text-lg font-semibold">{t("cash.change")}: <Ltr>{formatPkr(r2(Math.max(0, tnd - amt)))}</Ltr></p>
          <div className="space-y-1"><Label htmlFor="dnote">{t("cash.note")}</Label>
            <Textarea id="dnote" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      )}
    </SidePanel>
  );
}

function RefundPanel({ open, onOpenChange, invoice, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; invoice: Invoice; onDone: (r: Omit<ReceiptData, "patient">) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(""); setReason(""); } }, [open]);
  const amt = Number(amount) || 0;
  const max = Number(invoice.paid);
  const save = async () => {
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ payment: Payment; invoice: Invoice }>("issue-refund", { invoice_id: invoice.id, amount: amt, reason });
      onDone({ kind: "refund", receipt_no: res.payment.receipt_no, amount: res.payment.amount, balance: Number(res.invoice.balance), invoice_no: invoice.invoice_no, reason, at: res.payment.created_at });
      toast.success(t("cash.refunded")); onOpenChange(false);
    } catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("cash.refund")} description={t("cash.refundMax", { amount: formatPkr(max) })}
      footer={<Button variant="danger" disabled={amt <= 0 || amt > max || reason.trim().length < 3 || busy} onClick={() => void save()}><RotateCcw /> {t("cash.refund")}</Button>}>
      <div className="space-y-4">
        <div className="space-y-1"><Label htmlFor="ramt">{t("cash.refundAmount")}</Label>
          <Input id="ramt" dir="ltr" inputMode="decimal" className="h-12 text-xl" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></div>
        <div className="space-y-1"><Label htmlFor="rreason">{t("cash.reasonRequired")}</Label>
          <Textarea id="rreason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
    </SidePanel>
  );
}

function ReversalPanel({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(""); }, [payment]);
  const save = async () => {
    if (!payment) return;
    setBusy(true);
    try { await callEdgeFunction("request-approval", { type: "reversal", invoice_id: payment.invoice_id, payment_id: payment.id, reason }); toast.success(t("cash.rev.requested")); onDone(); onClose(); }
    catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={!!payment} onOpenChange={(o) => !o && onClose()} title={t("cash.rev.request")} description={t("cash.rev.explain")}
      footer={<Button disabled={reason.trim().length < 3 || busy} onClick={() => void save()}><Undo2 /> {t("cash.rev.send")}</Button>}>
      {payment && (
        <div className="space-y-4">
          <p><Ltr className="font-medium">{payment.receipt_no}</Ltr> · <Ltr>{formatPkr(payment.amount)}</Ltr></p>
          <div className="space-y-1"><Label htmlFor="vreason">{t("cash.reasonRequired")}</Label>
            <Textarea id="vreason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
      )}
    </SidePanel>
  );
}

function PlanCard({ plan }: { plan: InstallmentPlan }) {
  const { t } = useTranslation();
  const today = todayPk();
  return (
    <div className="rounded-staff border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{t("plan.title")}</h3>
        <StatusChip status={plan.status === "active" ? "progress" : "ok"}>{t(`plan.status.${plan.status}`)}</StatusChip>
      </div>
      <ol className="divide-y text-sm">
        {plan.schedule.map((s, i) => {
          const done = s.paid >= s.amount;
          const late = !done && s.due_date < today;
          return (
            <li key={s.due_date} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{i + 1}. <Ltr>{s.due_date}</Ltr></span>
              <span className={cn(late && "font-semibold text-urgent-fg", done && "text-ok-fg")}>
                <Ltr>{formatPkr(s.paid)}</Ltr> / <Ltr>{formatPkr(s.amount)}</Ltr> · {done ? t("plan.paid") : late ? t("plan.overdue") : t("plan.due")}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
