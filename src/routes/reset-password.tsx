import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { AuthCard } from "@/components/mc/auth-card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — MediCore HMS" },
      { name: "description", content: "Choose a new password for your MediCore staff account." },
      { property: "og:title", content: "Set a new password — MediCore HMS" },
      { property: "og:description", content: "Choose a new password for your MediCore staff account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPage,
});

const validPw = (p: string) => p.length >= 8 && /[a-z]/i.test(p) && /\d/.test(p);

function ResetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash.includes("error")) return setState("invalid");
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) setState("ready");
    });
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setState((s) => (s === "checking" ? (data.session ? "ready" : "invalid") : s));
    }, 1500);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validPw(pw)) return setError(t("auth.pwRule"));
    if (pw !== pw2) return setError(t("auth.mismatch"));
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(t("auth.linkInvalid"));
    await supabase.auth.signOut();
    toast.success(t("auth.resetDone"));
    navigate({ to: "/auth", replace: true });
  }

  return (
    <AuthCard title={t("auth.resetTitle")}>
      {state === "checking" && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("auth.checkingLink")}
        </p>
      )}
      {state === "invalid" && (
        <div className="space-y-4">
          <Banner tone="danger" title={t("auth.linkInvalid")} />
          <Link to="/forgot-password" className="block text-center text-sm font-medium text-primary hover:underline">
            {t("auth.forgotLink")}
          </Link>
        </div>
      )}
      {state === "ready" && (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="pw">{t("auth.newPassword")}</Label>
            <Input id="pw" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("auth.pwRule")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">{t("auth.confirmPassword")}</Label>
            <Input id="pw2" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t("auth.savePassword")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
