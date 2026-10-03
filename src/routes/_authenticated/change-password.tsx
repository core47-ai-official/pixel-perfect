import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HospitalLogo } from "@/components/mc/hospital-logo";
import { SessionGate } from "@/components/mc/session-gate";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { signOutEverywhere } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({ meta: [{ title: "Change password — MediCore HMS" }] }),
  component: () => (
    <SessionGate>
      <ChangePassword />
    </SessionGate>
  ),
});

const strong = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function ChangePassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = useEdgeFunction<{ ok: true }, { new_password: string }>("change-own-password", {
    invalidate: [["my-context"]],
    successMessage: t("pwd.done"),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!strong(pw)) return setError(t("pwd.weak"));
    if (pw !== confirm) return setError(t("pwd.mismatch"));
    try {
      await change.mutateAsync({ new_password: pw });
      navigate({ to: "/dashboard", replace: true });
    } catch {
      /* toast already shown */
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <HospitalLogo />
          <h1 className="text-xl font-semibold text-foreground">{t("pwd.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pwd.subtitle")}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pw">{t("pwd.new")}</Label>
            <Input id="pw" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("pwd.rules")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">{t("pwd.confirm")}</Label>
            <Input id="pw2" type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={change.isPending}>
            {change.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {change.isPending ? t("pwd.saving") : t("pwd.submit")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => signOutEverywhere(qc, navigate)}>
            {t("auth.signOut")}
          </Button>
        </form>
      </div>
    </main>
  );
}
