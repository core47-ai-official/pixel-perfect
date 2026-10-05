import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Ltr } from "@/components/mc/ltr";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";

interface Hit { id: string; mrn: string; full_name: string; age: number | null; gender: string | null; phone: string | null; cnic: string | null }

/** Top-bar patient search. F2 focuses; arrows move; Enter opens the profile. */
export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const res = useQuery({
    queryKey: ["patients", "search", debounced],
    queryFn: () => callEdgeFunction<Hit[]>("search-patients", { q: debounced }),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
    retry: false,
  });
  const hits = res.data ?? [];
  useEffect(() => setActive(0), [debounced]);

  const optionCount = hits.length > 0 ? hits.length : 1; // "Register new" is the single option when empty
  const go = (i: number) => {
    setOpen(false); setQ(""); inputRef.current?.blur();
    const h = hits[i];
    if (h) void navigate({ to: "/patients/$patientId", params: { patientId: h.id } });
    else void navigate({ to: "/patients/new" });
  };

  const showPanel = open && debounced.length >= 2;
  const ready = showPanel && !res.isFetching && res.isFetched;

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        className="h-9 pe-10 ps-8"
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-list"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % optionCount); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + optionCount) % optionCount); }
          else if (e.key === "Enter" && ready) { e.preventDefault(); go(active); }
          else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
        }}
      />
      <kbd className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">F2</kbd>

      {showPanel && (
        <div id="global-search-list" role="listbox" className="absolute end-0 top-full z-50 mt-1 w-[min(26rem,90vw)] overflow-hidden rounded-staff border bg-popover text-popover-foreground shadow-lg">
          {!ready && <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("search.searching")}</div>}
          {ready && res.isError && <div className="px-3 py-3 text-sm text-urgent">{t("search.failed")}</div>}
          {ready && !res.isError && hits.map((h, i) => (
            <button key={h.id} type="button" role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => go(i)}
              className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm", i === active && "bg-accent text-accent-foreground")}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{h.full_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {h.age !== null ? t("pat.ageYears", { count: h.age }) : t("ph.ageUnknown")}{h.gender && ` / ${t(`doc.genders.${h.gender}`)}`}
                  {h.phone && <> · <Ltr>{h.phone}</Ltr></>}
                </span>
              </span>
              <Ltr className="shrink-0 text-xs font-medium">{h.mrn}</Ltr>
            </button>
          ))}
          {ready && !res.isError && hits.length === 0 && (
            <>
              <p className="px-3 pt-3 text-sm text-muted-foreground">{t("search.none")}</p>
              <button type="button" role="option" aria-selected onMouseDown={(e) => e.preventDefault()} onClick={() => go(0)}
                className="m-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
                <UserPlus className="size-4" />{t("search.register")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
