import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { AuthCard } from "@/components/mc/auth-card";
import { callEdgeFunction, type EdgeError } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — MediCore HMS" },
      { name: "description", content: "Request a password reset link for your MediCore staff account." },
      { property: "og:title", content: "Forgot password — MediCore HMS" },
      { property: "og:description", content: "Request a password reset link for your MediCore staff account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim().toLowerCase();
    if (!z.string().email().safeParse(value).success) return setError(t("auth.invalidEmail"));
    setBusy(true);
    const redirectTo = `${window.location.origin}/reset-password`;
    try {
      await callEdgeFunction("request-password-reset", { email: value, redirect_to: redirectTo });
    } catch (err) {
      // Until the Edge Function is deployed, ask Supabase Auth directly — it also never reveals whether the email exists.
      if ((err as EdgeError)?.code === "network") {
        await supabase.auth.resetPasswordForEmail(value, { redirectTo }).catch(() => undefined);
      }
    }
    // Always the same outcome, whatever happened.
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthCard title={t("auth.forgotTitle")} {...(sent ? {} : { subtitle: t("auth.forgotBody") })}>
      {sent ? (
        <Banner tone="success" title={t("auth.sentMessage")} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t("auth.sending") : t("auth.sendLink")}
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm text-muted-foreground">{t("auth.noEmail")}</p>
      <Link to="/auth" className="mt-4 block text-center text-sm font-medium text-primary hover:underline">
        {t("auth.backToSignIn")}
      </Link>
    </AuthCard>
  );
}
