import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { AuthCard } from "@/components/mc/auth-card";
import { normalizePkPhone } from "@/lib/session";

const search = z.object({ reason: z.enum(["deactivated", "timeout", "hospital"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Sign in — MediCore HMS" },
      { name: "description", content: "Staff sign-in for MediCore hospital management." },
      { property: "og:title", content: "Sign in — MediCore HMS" },
      { property: "og:description", content: "Staff sign-in for MediCore hospital management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reason } = Route.useSearch();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (reason) return; // just signed out — stay here
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate, reason]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const id = identifier.trim();
    if (!id || !password) return setError(t("auth.required"));
    setBusy(true);
    const phone = id.includes("@") ? null : normalizePkPhone(id);
    const { error: err } = id.includes("@")
      ? await supabase.auth.signInWithPassword({ email: id, password })
      : phone
        ? await supabase.auth.signInWithPassword({ phone, password })
        : { error: new Error("invalid") };
    setBusy(false);
    if (err) return setError(t("auth.invalid"));
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <AuthCard title={t("auth.title")} subtitle={t("auth.subtitle")}>
          {reason && (
            <div className="mb-4">
              <Banner tone={reason === "timeout" ? "info" : "danger"} title={t(`auth.reason_${reason}`)} />
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="identifier">{t("auth.identifier")}</Label>
              <Input
                id="identifier"
                dir="ltr"
                autoComplete="username"
                inputMode="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t("auth.identifierHint")}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                  {t("auth.forgotLink")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? t("auth.signingIn") : t("auth.submit")}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("psignup.newPatient")} <Link to="/patient-signup" className="text-primary underline">{t("psignup.create")}</Link>
          </p>
    </AuthCard>
  );
}
