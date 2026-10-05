import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Package, Plus, X } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { rs, usePackages, useTariffs, type Tariff, type TariffPackage } from "@/lib/tariffs";

export const Route = createFileRoute("/_authenticated/_app/packages")({
  head: () => ({ meta: [{ title: "Packages — MediCore HMS" }, { name: "description", content: "Fixed-price packages built from hospital tariffs." }] }),
  component: () => (
    <RequireRole roles={rolesForPage("packages")}>
      <PackagesPage />
    </RequireRole>
  ),
});

function PackagesPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("admin") || hasRole("super_admin");
  const packages = usePackages();
  const tariffs = useTariffs();
  const [editing, setEditing] = useState<TariffPackage | "new" | null>(null);
  const byCode = new Map((tariffs.data ?? []).map((x) => [x.code.toUpperCase(), x]));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("pk.intro")}</p>
        {canEdit && <Button className="ms-auto" onClick={() => setEditing("new")}><Plus />{t("pk.add")}</Button>}
      </div>
      {packages.isLoading ? <Skeleton className="h-48" /> : (packages.data ?? []).length === 0 ? (
        <EmptyState icon={Package} title={t("pk.empty")} description={canEdit ? t("pk.emptyHint") : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(packages.data ?? []).map((p) => {
            const total = p.tariff_codes.reduce((s, c) => s + (byCode.get(c)?.price ?? 0), 0);
            return (
              <div key={p.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1"><p className="font-semibold">{p.name}</p>{p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}</div>
                  <StatusChip status={p.is_active ? "ok" : "inactive"}>{t(p.is_active ? "tf.active" : "tf.inactive")}</StatusChip>
                </div>
                <div className="flex items-baseline gap-2"><Ltr className="text-2xl font-bold">{rs(p.price)}</Ltr>
                  {total > p.price && <Ltr className="text-sm text-muted-foreground line-through">{rs(total)}</Ltr>}</div>
                <p className="text-xs text-muted-foreground">{t("pk.validFor", { n: p.valid_days })}</p>
                <ul className="space-y-1 text-sm">
                  {p.tariff_codes.map((c) => (
                    <li key={c} className="flex gap-2"><Ltr className="font-mono text-xs text-muted-foreground">{c}</Ltr><span className="truncate">{byCode.get(c)?.name ?? t("pk.missing")}</span></li>
                  ))}
                </ul>
                {canEdit && <Button variant="outline" size="sm" className="mt-auto" onClick={() => setEditing(p)}>{t("wd.edit")}</Button>}
              </div>
            );
          })}
        </div>
      )}
      {editing && <PackageForm key={editing === "new" ? "new" : editing.id} target={editing} tariffs={tariffs.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PackageForm({ target, tariffs, onClose }: { target: TariffPackage | "new"; tariffs: Tariff[]; onClose: () => void }) {
  const { t } = useTranslation();
  const init = target === "new" ? null : target;
  const [name, setName] = useState(init?.name ?? "");
  const [desc, setDesc] = useState(init?.description ?? "");
  const [price, setPrice] = useState(init ? String(init.price) : "");
  const [days, setDays] = useState(init ? String(init.valid_days) : "1");
  const [active, setActive] = useState(init?.is_active ?? true);
  const [codes, setCodes] = useState<string[]>(init?.tariff_codes ?? []);
  const [q, setQ] = useState("");
  const byCode = new Map(tariffs.map((x) => [x.code.toUpperCase(), x]));
  const total = codes.reduce((s, c) => s + (byCode.get(c)?.price ?? 0), 0);
  const matches = q.trim().length < 1 ? [] : tariffs.filter((x) => x.is_active && !codes.includes(x.code.toUpperCase()) &&
    (x.code.toLowerCase().includes(q.toLowerCase()) || x.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  const save = useEdgeFunction("upsert-package", { invalidate: [["packages"]], successMessage: t("pk.saved") });
  const submit = async () => {
    if (name.trim().length < 2 || price === "" || !codes.length || Number(days) < 1) { toast.error(t("pk.required")); return; }
    try { await save.mutateAsync({ id: init?.id, name, description: desc, price: Number(price), valid_days: Number(days), is_active: active, tariff_codes: codes }); onClose(); } catch { /* shown */ }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={init ? t("pk.edit") : t("pk.add")}
      footer={<><Button variant="outline" onClick={onClose}>{t("wd.cancel")}</Button><Button onClick={submit} disabled={save.isPending}>{t("wd.save")}</Button></>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="pk-name">{t("pk.name")} *</Label><Input id="pk-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pk-desc">{t("pk.description")}</Label><Textarea id="pk-desc" rows={2} value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pk-q">{t("pk.includes")} *</Label>
          <Input id="pk-q" placeholder={t("pk.searchTariff")} value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && <div className="rounded-md border">
            {matches.map((m) => (
              <button key={m.id} type="button" className="flex w-full gap-2 border-b px-3 py-1.5 text-start text-sm last:border-0 hover:bg-accent"
                onClick={() => { setCodes([...codes, m.code.toUpperCase()]); setQ(""); }}>
                <Ltr className="font-mono text-xs">{m.code}</Ltr><span className="flex-1 truncate">{m.name}</span><Ltr className="text-xs">{rs(m.price)}</Ltr>
              </button>
            ))}
          </div>}
          <ul className="space-y-1 pt-1">
            {codes.map((c) => (
              <li key={c} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-sm">
                <Ltr className="font-mono text-xs">{c}</Ltr><span className="flex-1 truncate">{byCode.get(c)?.name ?? t("pk.missing")}</span>
                <Ltr className="text-xs">{rs(byCode.get(c)?.price ?? 0)}</Ltr>
                <button type="button" aria-label={t("pk.remove")} onClick={() => setCodes(codes.filter((x) => x !== c))}><X className="size-4" /></button>
              </li>
            ))}
          </ul>
          {codes.length > 0 && <p className="text-xs text-muted-foreground">{t("pk.itemsTotal")} <Ltr>{rs(total)}</Ltr></p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="pk-price">{t("pk.price")} *</Label><Input id="pk-price" type="number" min={0} step="0.01" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pk-days">{t("pk.validDays")} *</Label><Input id="pk-days" type="number" min={1} max={365} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3"><Label htmlFor="pk-active">{t("tf.active")}</Label><Switch id="pk-active" checked={active} onCheckedChange={setActive} /></div>
      </div>
    </SidePanel>
  );
}
