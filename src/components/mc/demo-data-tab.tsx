import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { callEdgeFunction } from "@/hooks/use-edge-function";

interface Account { name: string; role: string; email: string; password: string }
interface SeedResult { counts: Record<string, number>; accounts: Account[] }

/** Company settings → Demo data: seed / clear (super_admin). Passwords are shown once, never stored. */
export function DemoDataTab({ canEdit, isLive }: { canEdit: boolean; isLive: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"seed" | "clear" | null>(null);
  const [res, setRes] = useState<SeedResult | null>(null);

  const run = async (kind: "seed" | "clear") => {
    if (kind === "clear" && !window.confirm(t("demo.confirmClear"))) return;
    setBusy(kind);
    try {
      if (kind === "seed") { setRes(await callEdgeFunction<SeedResult>("seed-demo-data", {})); toast.success(t("demo.done")); }
      else { const r = await callEdgeFunction<{ removed: number }>("clear-demo-data", {}); setRes(null); toast.success(t("demo.cleared", { n: r.removed })); }
      await qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const csv = () => {
    if (!res) return;
    const rows = [["name", "role", "email", "password"], ...res.accounts.map((a) => [a.name, a.role, a.email, a.password])];
    const blob = new Blob([rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "demo-logins.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("demo.intro")}</p>
      {!canEdit && <Banner tone="info" title={t("demo.readOnly")} />}
      {isLive && <Banner tone="warning" title={t("demo.live")} />}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run("seed")} disabled={!!busy || isLive}>{busy === "seed" ? t("demo.seeding") : t("demo.seed")}</Button>
          <Button variant="secondary" onClick={() => run("clear")} disabled={!!busy}>{busy === "clear" ? t("demo.clearing") : t("demo.clear")}</Button>
        </div>
      )}
      {res && (
        <div className="space-y-3">
          <Banner tone="warning" title={t("demo.once")} />
          <p className="text-sm"><Ltr>{Object.entries(res.counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}</Ltr></p>
          <Button variant="secondary" onClick={csv}><Download /> {t("demo.download")}</Button>
          <div className="overflow-x-auto rounded-staff border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-start"><tr>{["name", "role", "email", "password"].map((k) => <th key={k} className="p-2 text-start font-medium">{t(`demo.${k}`)}</th>)}</tr></thead>
              <tbody>
                {res.accounts.map((a) => (
                  <tr key={a.email} className="border-t">
                    <td className="p-2">{a.name}</td><td className="p-2">{a.role}</td>
                    <td className="p-2"><Ltr className="font-mono">{a.email}</Ltr></td><td className="p-2"><Ltr className="font-mono">{a.password}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
