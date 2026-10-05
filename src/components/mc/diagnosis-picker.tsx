import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ClipboardList, Search, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ltr } from "@/components/mc/ltr";
import { cn } from "@/lib/utils";

interface Dx { code: string; description: string; is_primary: boolean }
interface Hit { code: string; description: string; chapter: string | null }

function useVisitDiagnoses(visitId: string) {
  return useQuery({
    queryKey: ["visit-diagnoses", visitId],
    queryFn: async (): Promise<Dx[]> => {
      const { data, error } = await supabase
        .from("visit_diagnoses")
        .select("icd10_code, description, is_primary")
        .eq("visit_id", visitId)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({ code: r.icd10_code, description: r.description, is_primary: r.is_primary }));
    },
  });
}

export function DiagnosisPicker({ visitId, canEdit }: { visitId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = useVisitDiagnoses(visitId);
  const [list, setList] = useState<Dx[]>([]);
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (saved.data && !dirty) setList(saved.data); }, [saved.data, dirty]);
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);

  const search = useQuery({
    queryKey: ["icd10-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: () => callEdgeFunction<Hit[]>("search-icd10", { q: debounced }),
    staleTime: 60_000,
  });
  const hits = (search.data ?? []).filter((h) => !list.some((d) => d.code === h.code));

  const update = (next: Dx[]) => {
    if (next.length && !next.some((d) => d.is_primary)) next = next.map((d, i) => ({ ...d, is_primary: i === 0 }));
    setList(next);
    setDirty(true);
  };
  const add = (h: Hit) => {
    update([...list, { code: h.code, description: h.description, is_primary: false }]);
    setQ(""); setOpen(false); setActive(0);
  };

  const save = async () => {
    setSaving(true);
    try {
      await callEdgeFunction("save-diagnoses", {
        visit_id: visitId,
        diagnoses: list.map((d) => ({ code: d.code, is_primary: d.is_primary })),
      });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["visit-diagnoses", visitId] });
      toast.success(t("dx.saved"));
    } catch (e) {
      toast.error((e as EdgeError).message ?? t("errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><ClipboardList className="size-4" />{t("consult.diagnosis")}</h2>

      {canEdit && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            role="combobox"
            aria-expanded={open}
            aria-label={t("dx.searchPh")}
            className="ps-8"
            value={q}
            placeholder={t("dx.searchPh")}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && hits[active]) { e.preventDefault(); add(hits[active]); }
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          {open && debounced.length >= 2 && (
            <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {search.isLoading && <li className="px-2 py-1.5 text-muted-foreground">{t("dx.searching")}</li>}
              {search.isError && <li className="px-2 py-1.5 text-muted-foreground">{t("dx.unavailable")}</li>}
              {search.isSuccess && hits.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">{t("dx.none")}</li>}
              {hits.map((h, i) => (
                <li
                  key={h.code}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); add(h); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer gap-2 rounded px-2 py-1.5", i === active && "bg-accent text-accent-foreground")}
                >
                  <Ltr className="w-14 shrink-0 font-mono font-semibold">{h.code}</Ltr>
                  <Ltr className="text-start">{h.description}</Ltr>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-muted-foreground">{t("dx.empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((d) => (
            <li
              key={d.code}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
                d.is_primary ? "border-primary bg-primary/10" : "bg-muted",
              )}
            >
              <button
                type="button"
                disabled={!canEdit}
                aria-label={t("dx.markPrimary")}
                title={d.is_primary ? t("dx.primary") : t("dx.markPrimary")}
                onClick={() => update(list.map((x) => ({ ...x, is_primary: x.code === d.code })))}
                className="disabled:cursor-default"
              >
                <Star className={cn("size-4", d.is_primary ? "fill-primary text-primary" : "text-muted-foreground")} />
              </button>
              <Ltr className="font-mono font-semibold">{d.code}</Ltr>
              <Ltr className="truncate">{d.description}</Ltr>
              {canEdit && (
                <button type="button" aria-label={t("dx.remove")} onClick={() => update(list.filter((x) => x.code !== d.code))}>
                  <X className="size-3.5 text-muted-foreground" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setDirty(false); setList(saved.data ?? []); }}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={save} disabled={saving || list.length === 0}>{t("dx.save")}</Button>
        </div>
      )}
    </section>
  );
}
