import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { AuthCard } from "@/components/mc/auth-card";
import { supabase } from "@/integrations/supabase/client";
import { normalizePkPhone } from "@/lib/session";

export const Route = createFileRoute("/patient-signup")({
  head: () => ({ meta: [
    { title: "Create your patient account — MediCore" },
    { name: "description", content: "Sign up to see your appointments and reports from the hospital." },
    { property: "og:title", content: "Create your patient account — MediCore" },
    { property: "og:description", content: "Sign up to see your appointments and reports from the hospital." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: PatientSignup,
});

function PatientSignup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [f, setF] = useState({ full_name: "", login: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const login = f.login.trim();
    const isEmail = login.includes("@");
    const phone = isEmail ? null : normalizePkPhone(login);
    if (f.full_name.trim().length < 2 || !login) return setError(t("psignup.required"));
    if (!isEmail && !phone) return setError(t("psignup.badPhone"));
    if (f.password.length < 8) return setError(t("psignup.shortPassword"));
    if (f.password !== f.confirm) return setError(t("psignup.mismatch"));
    setBusy(true);
    const { data, error: fnErr } = await supabase.functions.invoke("patient-signup", {
      body: { full_name: f.full_name.trim(), password: f.password, ...(isEmail ? { email: login } : { phone: login }) },
    });
    const body = (data ?? null) as { ok?: boolean; error?: { message?: string } } | null;
    if (fnErr || !body?.ok) {
      let msg = body?.error?.message;
      try { const ctx = (fnErr as { context?: Response } | null)?.context; if (!msg && ctx) msg = (await ctx.json())?.error?.message; } catch { /* ignore */ }
      setBusy(false); return setError(msg ?? t("psignup.failed"));
    }
    const { error: inErr } = isEmail
      ? await supabase.auth.signInWithPassword({ email: login, password: f.password })
      : await supabase.auth.signInWithPassword({ phone: phone!, password: f.password });
    setBusy(false);
    if (inErr) return navigate({ to: "/auth", replace: true });
    navigate({ to: "/portal", replace: true });
  }

  return (
    <AuthCard title={t("psignup.title")} subtitle={t("psignup.subtitle")}>
      {error && <div className="mb-4"><Banner tone="danger" title={error} /></div>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5"><Label htmlFor="fn">{t("psignup.name")}</Label><Input id="fn" autoComplete="name" value={f.full_name} onChange={set("full_name")} /></div>
        <div className="space-y-1.5"><Label htmlFor="lg">{t("psignup.login")}</Label><Input id="lg" dir="ltr" autoComplete="username" placeholder="03001234567" value={f.login} onChange={set("login")} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw">{t("psignup.password")}</Label><Input id="pw" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw2">{t("psignup.confirm")}</Label><Input id="pw2" type="password" autoComplete="new-password" value={f.confirm} onChange={set("confirm")} /></div>
        <Button type="submit" className="w-full" disabled={busy}>{t("psignup.submit")}</Button>
        <p className="text-center text-sm text-muted-foreground">{t("psignup.haveAccount")} <Link to="/auth" className="text-primary underline">{t("psignup.signIn")}</Link></p>
      </form>
    </AuthCard>
  );
}
