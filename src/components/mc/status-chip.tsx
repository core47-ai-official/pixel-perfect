import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, AlertCircle, CheckCircle2, Loader2, MinusCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const chip = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
  {
    variants: {
      status: {
        urgent: "bg-urgent-soft text-urgent-fg",
        warning: "bg-warning-soft text-warning-fg",
        caution: "bg-caution-soft text-caution-fg",
        ok: "bg-ok-soft text-ok-fg",
        progress: "bg-progress-soft text-progress-fg",
        inactive: "bg-inactive-soft text-inactive-fg",
      },
    },
    defaultVariants: { status: "inactive" },
  },
);

const icons = {
  urgent: AlertCircle,
  warning: AlertTriangle,
  caution: Info,
  ok: CheckCircle2,
  progress: Loader2,
  inactive: MinusCircle,
};

export type Status = NonNullable<VariantProps<typeof chip>["status"]>;

/** Always shows an icon + text label; never colour alone. */
export function StatusChip({ status = "inactive", children, className }: { status?: Status; children: React.ReactNode; className?: string }) {
  const Icon = icons[status];
  return (
    <span className={cn(chip({ status }), className)}>
      <Icon aria-hidden />
      {children}
    </span>
  );
}
