import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const banner = cva("flex items-start gap-3 rounded-staff border px-4 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-progress/30 bg-progress-soft text-progress-fg",
      success: "border-ok/30 bg-ok-soft text-ok-fg",
      warning: "border-warning/30 bg-warning-soft text-warning-fg",
      danger: "border-urgent/30 bg-urgent-soft text-urgent-fg",
    },
  },
  defaultVariants: { tone: "info" },
});
const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertCircle };

export function Banner({
  tone = "info",
  title,
  children,
  onDismiss,
}: VariantProps<typeof banner> & { title: string; children?: React.ReactNode; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const Icon = icons[tone ?? "info"];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn(banner({ tone }))}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 opacity-90">{children}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label={t("common.dismiss")} className="opacity-70 hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
