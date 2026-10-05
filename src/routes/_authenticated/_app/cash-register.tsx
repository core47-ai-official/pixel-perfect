import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LockKeyhole, Printer, Unlock } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { formatPkr } from "@/lib/patient-summary";
import { r2 } from "@/lib/cash";
import { getShiftSummary, SHIFT_INVALIDATE, useMyOpenShift, useShiftHistory, type ShiftSummary } from "@/lib/shifts";

export const Route = createFileRoute("/_authenticated/_app/cash-register")({
  head: () => ({ meta: [
    { title: "Cash register — MediCore HMS" },
    { name: "description", content: "Open and close cashier shifts, count cash and print shift reports." },
  ] }),
  component: () => (
    <RequireRole roles={rolesForPage("cashRegister")}>
      <CashRegisterPage />
    </RequireRole>
  ),
});

const fmtDT = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const errMsg = (e: unknown, f: string) => (e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : f);

function CashRegisterPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mine = useMyOpenShift();
  const history = useShiftHistory();
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ShiftSummary | null>(null);
  const refresh = () => SHIFT_INVALIDATE.forEach((k) => void qc.invalidateQueries({ queryKey: k }));

  const open = mine.data;
  const countedN = counted === "" ? null : r2(Number(counted));
  const diff = open && countedN != null && Number.isFinite(countedN) ? r2(countedN - open.totals.expected_cash) : null;

  const openShift = async () => {
    setBusy(true);
    try { await callEdgeFunction("open-shift", { opening_cash: Number(opening || 0) }); toast.success(t("shift.opened")); setOpening(""); refresh(); }
    catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };
  const closeShift = async () => {
    setBusy(true);
    try {
      const r = await callEdgeFunction<ShiftSummary>("close-shift", { counted_cash: countedN, note });
      toast.success(t("shift.closed")); setCounted(""); setNote(""); refresh(); setReport(r);
    } catch (e) { toast.error(errMsg(e, t("cash.failed"))); } finally { setBusy(false); }
  };
  const showReport = async (id: string) => {
    try { const r = await getShiftSummary(id); if (r) setReport(r); } catch (e) { toast.error(errMsg(e, t("cash.failed"))); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">{t("nav.cashRegister")}</h1>

      {mine.isLoading ? null : !open ? (
        <section className="space-y-3 rounded-staff border bg-card p-4">
          <h2 className="font-semibold">{t("shift.openTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("shift.openHint")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor="op">{t("shift.openingCash")}</Label>
              <Input id="op" inputMode="decimal" className="w-48 text-lg" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" /></div>
            <Button disabled={busy || Number(opening || 0) < 0} onClick={() => void openShift()}><Unlock /> {t("shift.open")}</Button>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-staff border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("shift.current")}</h2>
            <StatusChip status="ok">{t("shift.status.open")} · <Ltr>{fmtDT(open.shift.opened_at)}</Ltr></StatusChip>
          </div>
          <Totals s={open} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="ct">{t("shift.countedCash")}</Label>
              <Input id="ct" inputMode="decimal" className="text-lg" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
            {diff != null && (
              <div className="self-end text-sm">
                {diff === 0 ? <StatusChip status="ok">{t("shift.matches")}</StatusChip>
                  : <StatusChip status="urgent">{t(diff > 0 ? "shift.over" : "shift.short")}: <Ltr>{formatPkr(Math.abs(diff))}</Ltr></StatusChip>}
              </div>
            )}
          </div>
          {diff != null && diff !== 0 && (
            <div className="space-y-1"><Label htmlFor="nt">{t("shift.noteRequired")}</Label>
              <Textarea id="nt" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || countedN == null || !Number.isFinite(countedN) || countedN < 0 || (diff !== 0 && note.trim().length < 3)} onClick={() => void closeShift()}>
              <LockKeyhole /> {t("shift.close")}
            </Button>
            <Button variant="outline" onClick={() => setReport(open)}><Printer /> {t("shift.printReport")}</Button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">{t("shift.history")}</h2>
        {history.error && <Banner tone="danger" title={t("cash.failed")} />}
        {!history.data?.length ? <EmptyState title={t("shift.none")} /> : (
          <div className="overflow-x-auto rounded-staff border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
                <tr>{["cashier", "opened", "closedAt", "expected", "counted", "difference", ""].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{k && t(`shift.col.${k}`)}</th>)}</tr>
              </thead>
              <tbody>
                {history.data.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">{s.cashier_name}</td>
                    <td className="px-3 py-2"><Ltr>{fmtDT(s.opened_at)}</Ltr></td>
                    <td className="px-3 py-2">{s.status === "open" ? <StatusChip status="ok">{t("shift.status.open")}</StatusChip> : <Ltr>{fmtDT(s.closed_at)}</Ltr>}</td>
                    <td className="px-3 py-2"><Ltr>{s.expected_cash != null ? formatPkr(s.expected_cash) : "—"}</Ltr></td>
                    <td className="px-3 py-2"><Ltr>{s.counted_cash != null ? formatPkr(s.counted_cash) : "—"}</Ltr></td>
                    <td className={`px-3 py-2 ${s.difference ? "text-urgent-fg font-medium" : ""}`}><Ltr>{s.difference != null ? formatPkr(s.difference) : "—"}</Ltr></td>
                    <td className="px-3 py-2 text-end"><Button size="sm" variant="ghost" onClick={() => void showReport(s.id)}><Printer /> {t("shift.report")}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report && <ShiftReport data={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function Totals({ s }: { s: ShiftSummary }) {
  const { t } = useTranslation();
  const rows: [string, number, number | null][] = [
    ["opening", s.shift.opening_cash, null],
    ["payments", s.totals.payments, s.totals.payment_count],
    ["deposits", s.totals.deposits, s.totals.deposit_count],
    ["refunds", -s.totals.refunds, s.totals.refund_count],
    ["reversals", -s.totals.reversals, s.totals.reversal_count],
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-3">
      {rows.map(([k, v, n]) => (
        <div key={k} className="rounded-staff border p-3">
          <dt className="text-xs text-muted-foreground">{t(`shift.t.${k}`)}{n != null && <> (<Ltr>{n}</Ltr>)</>}</dt>
          <dd className="text-lg font-semibold"><Ltr>{formatPkr(v)}</Ltr></dd>
        </div>
      ))}
      <div className="rounded-staff border border-primary/40 bg-primary/5 p-3">
        <dt className="text-xs text-muted-foreground">{t("shift.t.expected")}</dt>
        <dd className="text-lg font-bold"><Ltr>{formatPkr(s.totals.expected_cash)}</Ltr></dd>
      </div>
    </dl>
  );
}

/** 80mm shift report (staff document — English only). */
function ShiftReport({ data, onClose }: { data: ShiftSummary; onClose: () => void }) {
  const brand = usePrintBrand();
  const { shift: s, totals: x } = data;
  const row = (label: string, v: string) => (<><span>{label}</span><span className="text-end"><Ltr>{v}</Ltr></span></>);
  return (
    <PrintPreviewPanel open onOpenChange={(o) => !o && onClose()} brand={brand} paper="thermal80" printLanguage={null}
      job={{ documentType: "shift_report", documentId: s.id }}>
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt("shift.print.title")}</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {row(pt("shift.col.cashier"), s.cashier_name)}
            {row(pt("shift.col.opened"), fmtDT(s.opened_at))}
            {row(pt("shift.col.closedAt"), s.closed_at ? fmtDT(s.closed_at) : pt("shift.status.open"))}
          </div>
          <div className="mc-rule grid grid-cols-2 gap-x-2 gap-y-0.5 border-t pt-1">
            {row(pt("shift.t.opening"), formatPkr(s.opening_cash))}
            {row(`${pt("shift.t.payments")} (${x.payment_count})`, formatPkr(x.payments))}
            {row(`${pt("shift.t.deposits")} (${x.deposit_count})`, formatPkr(x.deposits))}
            {row(`${pt("shift.t.refunds")} (${x.refund_count})`, formatPkr(-x.refunds))}
            {row(`${pt("shift.t.reversals")} (${x.reversal_count})`, formatPkr(-x.reversals))}
          </div>
          <div className="mc-rule grid grid-cols-2 gap-x-2 gap-y-0.5 border-t pt-1 font-bold">
            {row(pt("shift.t.expected"), formatPkr(x.expected_cash))}
            {s.counted_cash != null && row(pt("shift.col.counted"), formatPkr(s.counted_cash))}
            {s.difference != null && row(pt("shift.col.difference"), formatPkr(s.difference))}
          </div>
          {s.note && <p>{pt("shift.print.note")}: {s.note}</p>}
          <p className="mc-rule border-t pt-6 text-xs">{pt("shift.print.signature")}: ____________________</p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
