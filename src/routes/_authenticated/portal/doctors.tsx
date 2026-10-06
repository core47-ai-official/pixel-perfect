import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { PERM_KEYS, useConnections, type Connection, type PermKey } from "@/lib/connections";

export const Route = createFileRoute("/_authenticated/portal/doctors")({
  head: () => ({ meta: [
    { title: "My doctors and sharing — Patient portal" },
    { name: "description", content: "Choose which doctors can see your health tracker and what they can see." },
    { property: "og:title", content: "My doctors and sharing — Patient portal" },
    { property: "og:description", content: "Share your health tracker with your doctors, and stop anytime." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DoctorsPage,
});

interface Doc { id: string; name: string; specialty: string; department: string | null; photo_url: string | null }

function DoctorsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const conns = useConnections("patient");
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [search, setSearch] = useState<{ q?: string; code?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ids = (conns.data ?? []).map((c) => c.doctor_id);
  const names = useQuery({
    queryKey: ["conn-doctors", ids.join(",")], enabled: ids.length > 0,
    queryFn: () => callEdgeFunction<Doc[]>("search-connectable-doctors", {}),
  });
  const found = useQuery({
    queryKey: ["conn-search", search], enabled: !!search,
    queryFn: () => callEdgeFunction<Doc[]>("search-connectable-doctors", search),
  });
  const docName = (id: string) => (names.data ?? []).find((d) => d.id === id);

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try { await fn(); toast.success(t(ok)); await qc.invalidateQueries({ queryKey: ["connections", "patient"] }); }
    catch (e) { toast.error((e as Error).message || t("conn.failed")); }
    finally { setBusy(null); }
  };
  const toggle = (c: Connection, k: PermKey, v: boolean) => {
    qc.setQueryData<Connection[]>(["connections", "patient"], (old) => old?.map((x) => x.id === c.id ? { ...x, permissions: { ...x.permissions, [k]: v } } : x));
    run(c.id, () => callEdgeFunction("update-connection-permissions", { connection_id: c.id, permissions: { [k]: v } }), "conn.saved");
  };
  const connectedIds = new Set(ids);

  return (
    <div className="space-y-4">
      <Link to="/portal/health" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{t("portal.health")}</Link>
      <h1 className="text-2xl font-semibold">{t("conn.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("conn.intro")}</p>

      {conns.isLoading ? <Skeleton className="h-40 rounded-patient" /> : !conns.data?.length ? (
        <PCard><p className="text-sm text-muted-foreground">{t("conn.none")}</p></PCard>
      ) : conns.data.map((c) => {
        const d = docName(c.doctor_id);
        return (
          <PCard key={c.id} className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{d?.name ?? "…"}</p>
                <p className="text-sm text-muted-foreground">{d?.specialty}{d?.department ? ` · ${d.department}` : ""}</p>
                <p className="mt-1 text-xs font-medium text-primary">{t(c.status === "active" ? "conn.active" : "conn.requested")}</p>
              </div>
              <Button variant="destructive" size="sm" disabled={busy === c.id}
                onClick={() => run(c.id, () => callEdgeFunction("revoke-connection", { connection_id: c.id }), "conn.revoked")}>
                {t(c.status === "active" ? "conn.revoke" : "conn.withdraw")}
              </Button>
            </div>
            <ul className="divide-y">
              {PERM_KEYS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-3 py-2">
                  <label htmlFor={`${c.id}-${k}`} className="text-sm">{t(`conn.perm_${k}`)}</label>
                  <Switch id={`${c.id}-${k}`} checked={c.permissions?.[k] !== false} onCheckedChange={(v) => toggle(c, k, v)} />
                </li>
              ))}
            </ul>
          </PCard>
        );
      })}

      <PCard className="space-y-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q }); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("conn.search")} aria-label={t("conn.search")} />
          <Button type="submit" variant="secondary" aria-label={t("conn.find")}><Search className="size-4" /></Button>
        </form>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) setSearch({ code: code.trim() }); }}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder={t("conn.codeHint")} aria-label={t("conn.code")} dir="ltr" />
          <Button type="submit" variant="secondary">{t("conn.find")}</Button>
        </form>
        {found.isFetching ? <Skeleton className="h-16" /> : search && (found.data?.length ? (
          <ul className="divide-y">
            {found.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2"><UserRound className="size-5 text-muted-foreground" aria-hidden />
                  <div><p className="font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.specialty}{d.department ? ` · ${d.department}` : ""}</p></div></div>
                {connectedIds.has(d.id) ? <span className="text-xs text-muted-foreground">{t("conn.requested")}</span> : (
                  <Button size="sm" disabled={busy === d.id}
                    onClick={() => run(d.id, () => callEdgeFunction("request-connection", search?.code ? { doctor_code: search.code } : { doctor_id: d.id }), "conn.sent")}>
                    {t("conn.connect")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("conn.noDoctors")}</p>)}
        <p className="text-xs text-muted-foreground"><Ltr>{t("conn.code")}</Ltr>: {t("conn.codeHint")}</p>
      </PCard>
    </div>
  );
}
