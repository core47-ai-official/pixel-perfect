import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { SidePanel } from "@/components/mc/side-panel";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { formatPkr } from "@/lib/patient-summary";
import type { Invoice } from "@/components/mc/patient-bills-tab";
import type { Approval } from "@/lib/approvals";
import { cn } from "@/lib/utils";

type Kind = "discount" | "waiver" | "installment";

/** Ask for a discount, waiver or installment plan on a bill. Small discounts within the role's limit apply at once. */
export function RequestApprovalPanel({ open, onOpenChange, invoice, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; invoice: Invoice; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("discount");
  const [byPercent, setByPercent] = useState(true);
  const [value, setValue] = useState("");
  const [installments, setInstallments] = useState("2");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setKind("discount"); setValue(""); setReason(""); setByPercent(true); setInstallments("2"); } }, [open]);

  const total = Number(invoice.total), balance = Number(invoice.balance);
  const v = Number(value) || 0;
  const amount = kind === "waiver" ? balance : kind === "discount" ? Math.round((byPercent ? (total * v) / 100 : v) * 100) / 100 : balance;
  const valid = reason.trim().length >= 3 && (kind !== "discount" || (v > 0 && amount <= balance && (!byPercent || v <= 100)));

  const save = async () => {
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ approval: Approval; applied: boolean }>("request-approval", {
        type: kind, invoice_id: invoice.id, reason,
        ...(kind === "discount" ? (byPercent ? { percent: v } : { amount: v }) : {}),
        ...(kind === "installment" ? { details: { installments: Number(installments) || 2 } } : {}),
      });
      toast.success(res.applied ? t("apv.appliedNow") : t("apv.sent"));
      onDone(); onOpenChange(false);
    } catch (e) { toast.error((e as { message?: string })?.message || t("cash.failed")); } finally { setBusy(false); }
  };

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={t("apv.requestTitle")} description={t("apv.requestHint")}
      footer={<Button disabled={!valid || busy} onClick={() => void save()}><Send /> {t("apv.submit")}</Button>}>
      <div className="space-y-4">
        <p className="text-sm"><Ltr className="font-medium">{invoice.invoice_no}</Ltr> · {t("cash.total")} <Ltr>{formatPkr(total)}</Ltr> · {t("cash.balance")} <Ltr>{formatPkr(balance)}</Ltr></p>
        <div className="inline-flex rounded-staff border p-0.5">
          {(["discount", "waiver", "installment"] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? "primary" : "ghost"} onClick={() => setKind(k)}>{t(`apv.type.${k}`)}</Button>
          ))}
        </div>
        {kind === "discount" && (
          <div className="space-y-2">
            <div className="inline-flex rounded-staff border p-0.5">
              <Button size="sm" variant={byPercent ? "primary" : "ghost"} onClick={() => setByPercent(true)}>%</Button>
              <Button size="sm" variant={!byPercent ? "primary" : "ghost"} onClick={() => setByPercent(false)}>Rs</Button>
            </div>
            <Label htmlFor="apv-v">{byPercent ? t("apv.percent") : t("apv.amount")}</Label>
            <Input id="apv-v" dir="ltr" inputMode="decimal" className="h-12 text-xl" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
            <p className={cn("text-sm", amount > balance ? "text-urgent-fg" : "text-muted-foreground")}>{t("apv.discountIs")} <Ltr>{formatPkr(amount)}</Ltr></p>
          </div>
        )}
        {kind === "waiver" && <p className="text-sm">{t("apv.waiverIs")} <Ltr className="font-semibold">{formatPkr(balance)}</Ltr></p>}
        {kind === "installment" && (
          <div className="space-y-1">
            <Label htmlFor="apv-n">{t("apv.installments")}</Label>
            <Input id="apv-n" dir="ltr" inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="apv-r">{t("cash.reasonRequired")}</Label>
          <Textarea id="apv-r" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </SidePanel>
  );
}
