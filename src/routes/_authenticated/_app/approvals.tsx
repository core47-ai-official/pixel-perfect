import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Inbox, X } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { useMyContext } from "@/hooks/use-my-context";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { formatPkr } from "@/lib/patient-summary";
import { APPROVAL_TONE, useApprovals, type Approval } from "@/lib/approvals";
import { CASH_INVALIDATE } from "@/lib/cash";

export const Route = createFileRoute("/_authenticated/_app/approvals")({
  head: () => ({ meta: [{ title: "Approvals — MediCore HMS" }, { name: "description", content: "Approve or reject discounts, waivers, refunds and reversals." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("approvals")}>
      <ApprovalsPage />
    </RequireRole>
  ),
});

function ApprovalsPage() {
  const { t } = useTranslation();
  const { hasRole, context } = useMyContext();
  const isAdmin = hasRole("super_admin", "admin");
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const list = useApprovals({ status: tab, mine: isAdmin ? null : context?.profile?.id ?? null });
  const [deciding, setDeciding] = useState<{ a: Approval; decision: "approved" | "rejected" } | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">{isAdmin ? t("apv.inbox") : t("apv.mine")}</h1>
      <div className="inline-flex rounded-staff border p-0.5">
        {(["pending", "decided"] as const).map((k) => (
          <Button key={k} size="sm" variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{t(`apv.tab.${k}`)}</Button>
        ))}
      </div>
      {list.isError && <Banner title={t("apv.loadError")} />}
      {list.data?.length === 0 && <EmptyState icon={Inbox} title={tab === "pending" ? t("apv.nonePending") : t("apv.noneDecided")} />}
      <ul className="space-y-2">
        {list.data?.map((a) => (
          <li key={a.id} className="rounded-staff border bg-surface p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-semibold">
                  {t(`apv.type.${a.type}`)} · <Ltr>{formatPkr(a.amount)}</Ltr>
                  {a.percent != null && <span className="text-muted-foreground"> (<Ltr>{`${a.percent}%`}</Ltr>)</span>}
                </p>
                <p className="text-sm">{a.patients?.full_name} · <Ltr>{a.patients?.mrn}</Ltr> · <Ltr>{a.invoices?.invoice_no}</Ltr>
                  {a.invoices && <> · {t("cash.balance")} <Ltr>{formatPkr(a.invoices.balance)}</Ltr></>}</p>
                <p className="text-sm text-muted-foreground">{a.reason}</p>
                {a.type === "installment" && Array.isArray(a.details?.["schedule"]) && (
                  <p className="text-sm">{t("apv.installmentsN", { n: (a.details["schedule"] as unknown[]).length })}: {(a.details["schedule"] as { due_date: string; amount: number }[]).map((x) => <Ltr key={x.due_date} className="me-2">{`${x.due_date} ${formatPkr(x.amount)}`}</Ltr>)}</p>
                )}
                <p className="text-xs text-muted-foreground">{a.requested_by_name} · <Ltr>{new Date(a.created_at).toLocaleString()}</Ltr></p>
                {a.decision_note && <p className="text-sm">{t("apv.note")}: {a.decision_note}</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusChip status={APPROVAL_TONE[a.status]}>{t(`apv.status.${a.status}`)}</StatusChip>
                {isAdmin && a.status === "pending" && (
                  <span className="flex gap-1">
                    <Button size="sm" onClick={() => setDeciding({ a, decision: "approved" })}><Check /> {t("apv.approve")}</Button>
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ a, decision: "rejected" })}><X /> {t("apv.reject")}</Button>
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <DecidePanel state={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function DecidePanel({ state, onClose }: { state: { a: Approval; decision: "approved" | "rejected" } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reject = state?.decision === "rejected";
  const save = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await callEdgeFunction("decide-approval", { approval_id: state.a.id, decision: state.decision, note });
      toast.success(reject ? t("apv.rejectedToast") : t("apv.approvedToast"));
      [["approvals"], ...CASH_INVALIDATE].forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      setNote(""); onClose();
    } catch (e) { toast.error((e as { message?: string })?.message || t("cash.failed")); } finally { setBusy(false); }
  };
  return (
    <SidePanel open={!!state} onOpenChange={(o) => { if (!o) { setNote(""); onClose(); } }}
      title={reject ? t("apv.rejectTitle") : t("apv.approveTitle")}
      description={state ? `${t(`apv.type.${state.a.type}`)} · ${formatPkr(state.a.amount)}` : ""}
      footer={<Button variant={reject ? "danger" : "primary"} disabled={busy || (reject && note.trim().length < 3)} onClick={() => void save()}>
        {reject ? <X /> : <Check />} {reject ? t("apv.reject") : t("apv.approve")}</Button>}>
      <div className="space-y-1">
        <Label htmlFor="apv-note">{reject ? t("apv.noteRequired") : t("apv.noteOptional")}</Label>
        <Textarea id="apv-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
    </SidePanel>
  );
}
