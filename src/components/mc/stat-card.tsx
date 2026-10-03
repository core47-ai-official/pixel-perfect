import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  trend,
  caption,
  icon: Icon,
  goodWhen = "up",
}: {
  label: string;
  value: string | number;
  trend?: number;
  caption?: string;
  icon?: React.ComponentType<{ className?: string }>;
  goodWhen?: "up" | "down";
}) {
  const dir = trend === undefined || trend === 0 ? "flat" : trend > 0 ? "up" : "down";
  const good = dir === "flat" ? null : dir === goodWhen;
  const Arrow = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <div className="rounded-staff border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && (
          <span className="grid size-8 place-items-center rounded-staff bg-brand-soft text-brand-strong">
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tnum"><bdi dir="ltr" className="ltr-code">{value}</bdi></p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {trend !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tnum",
              good === null ? "text-inactive-fg" : good ? "text-ok-fg" : "text-urgent-fg",
            )}
          >
            <Arrow className="size-3.5" aria-hidden />
            <bdi dir="ltr" className="ltr-code">{Math.abs(trend)}%</bdi>
          </span>
        )}
        {caption && <span className="text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}
