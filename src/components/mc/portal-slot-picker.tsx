import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { useSlots, type Slot } from "@/lib/appointments";
import { pkDateLabel, pkNextDays } from "@/lib/portal";
import { cn } from "@/lib/utils";

/** Patient-style date strip + free slot grid for one doctor (get-available-slots). */
export function PortalSlotPicker({ doctorId, windowDays, selected, onPick }: {
  doctorId: string; windowDays: number; selected: Slot | null; onPick: (s: Slot | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const days = pkNextDays(Math.min(Math.max(windowDays, 1), 60));
  const [date, setDate] = useState(days[0]!);
  const slots = useSlots(doctorId, date);
  const free = (slots.data?.slots ?? []).filter((s) => s.status === "free");
  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label={t("portal.book.date")}>
        {days.map((d) => (
          <button key={d} type="button" role="option" aria-selected={d === date} onClick={() => { setDate(d); onPick(null); }}
            className={cn("shrink-0 rounded-patient border px-3 py-2 text-sm", d === date ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {pkDateLabel(d, i18n.language)}
          </button>
        ))}
      </div>
      {slots.isLoading ? <Skeleton className="h-24 rounded-patient" />
        : slots.isError ? <p className="text-sm text-destructive">{(slots.error as { message?: string })?.message ?? t("portal.book.slotsFailed")}</p>
        : slots.data?.closed ? <p className="text-sm text-muted-foreground">{t(`portal.book.closed.${slots.data.closed}`, { defaultValue: t("portal.book.noSlots") })}</p>
        : !free.length ? <p className="text-sm text-muted-foreground">{t("portal.book.noSlots")}</p>
        : (
          <div className="grid grid-cols-4 gap-2">
            {free.map((s) => (
              <button key={s.start} type="button" aria-pressed={selected?.start === s.start} onClick={() => onPick(s)}
                className={cn("rounded-patient border py-2 text-sm", selected?.start === s.start ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
                <Ltr>{s.time}</Ltr>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
