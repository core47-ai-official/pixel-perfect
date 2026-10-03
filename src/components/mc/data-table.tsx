import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  numeric?: boolean;
  render?: (row: T) => React.ReactNode;
};

export type Filter<T> = {
  key: keyof T & string;
  label: string;
  options: { value: string; label: string }[];
};

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  filters = [],
  searchKeys,
  pageSize = 5,
  onSelectionChange,
  bulkActions,
}: {
  rows: T[];
  columns: Column<T>[];
  filters?: Filter<T>[];
  searchKeys: (keyof T & string)[];
  pageSize?: number;
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: (ids: string[]) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let r = rows.filter((row) => {
      const s = q.trim().toLowerCase();
      if (s && !searchKeys.some((k) => String(row[k]).toLowerCase().includes(s))) return false;
      return Object.entries(f).every(([k, v]) => !v || v === "all" || String(row[k as keyof T]) === v);
    });
    if (sort) {
      r = [...r].sort((a, b) => {
        const av = a[sort.key as keyof T], bv = b[sort.key as keyof T];
        const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? c : -c;
      });
    }
    return r;
  }, [rows, q, f, sort, searchKeys]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  const allOnPage = visible.length > 0 && visible.every((r) => sel.has(r.id));

  const update = (next: Set<string>) => {
    setSel(next);
    onSelectionChange?.([...next]);
  };
  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  return (
    <div className="overflow-hidden rounded-staff border bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search…" className="ps-9" />
        </div>
        {filters.map((fl) => (
          <Select key={fl.key} value={f[fl.key] ?? "all"} onValueChange={(v) => { setF({ ...f, [fl.key]: v }); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder={fl.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any {fl.label.toLowerCase()}</SelectItem>
              {fl.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        {sel.size > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground tnum">{sel.size} selected</span>
            {bulkActions?.([...sel])}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={SearchX} title="No matching records" description="Try a different search or clear the filters."
          action={<Button variant="secondary" size="sm" onClick={() => { setQ(""); setF({}); }}>Clear filters</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead className="bg-surface-sunken text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox aria-label="Select page" checked={allOnPage}
                    onCheckedChange={(c) => { const n = new Set(sel); visible.forEach((r) => (c ? n.add(r.id) : n.delete(r.id))); update(n); }} />
                </th>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th key={c.key} className={cn("px-4 py-3 text-start font-medium", c.numeric && "text-end")}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.sortable ? (
                        <button onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
                          {c.header}<Icon className="size-3.5" />
                        </button>
                      ) : c.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={cn("border-t transition-colors hover:bg-muted/50", sel.has(r.id) && "bg-brand-soft")}>
                  <td className="px-4 py-3">
                    <Checkbox aria-label="Select row" checked={sel.has(r.id)}
                      onCheckedChange={(c) => { const n = new Set(sel); c ? n.add(r.id) : n.delete(r.id); update(n); }} />
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-4 py-3", c.numeric && "text-end")}>
                      {c.render ? c.render(r) : String(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
        <span className="tnum">{filtered.length === 0 ? "0" : `${cur * pageSize + 1}–${Math.min(filtered.length, (cur + 1) * pageSize)}`} of {filtered.length}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft /></Button>
          <span className="px-2 tnum">Page {cur + 1} of {pages}</span>
          <Button variant="ghost" size="icon" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
