import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

/** Confirmation that always requires a written reason (min 5 chars) for the audit log. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  const close = (o: boolean) => {
    if (!o) setReason("");
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-staff sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="confirm-reason">
            {t("common.reason")} <span className="text-urgent-fg">*</span>
          </Label>
          <Textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("common.reasonPlaceholder")}
          />
          {!valid && reason.length > 0 && (
            <p className="text-xs text-urgent-fg">{t("common.reasonMin")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{t("common.cancel")}</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!valid}
            onClick={() => {
              onConfirm(reason.trim());
              close(false);
            }}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
