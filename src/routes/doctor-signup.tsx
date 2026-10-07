import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { AuthCard } from "@/components/mc/auth-card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/doctor-signup")({
  head: () => ({ meta: [
    { title: "Register as an outside doctor — MediCore" },
    { name: "description", content: "Doctors outside the hospital can register so patients can share their health tracker with them." },
    { property: "og:title", content: "Register as an outside doctor — MediCore" },
    { property: "og:description", content: "Register with your PMDC number to connect with patients' health trackers." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DoctorSignup,
});

const MAX = 5 * 1024 * 1024;
const toB64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});

function DoctorSignup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [f, setF] = useState({ full_name: "", specialty: "", clinic: "", phone: "", email: "", pmdc_no: "", password: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (Object.values(f).some((v) => !v.trim()) || !file) return setError(t("dsignup.required"));
    if (file.size > MAX) return setError(t("dsignup.tooBig"));
    setBusy(true);
    const base64 = await toB64(file);
    const { data, error: fnErr } = await supabase.functions.invoke("register-outside-doctor", {
      body: { ...f, email: f.email.trim(), certificate: { name: file.name, type: file.type, base64 } },
    });
    const body = (data ?? null) as { ok?: boolean; error?: { message?: string } } | null;
    if (fnErr || !body?.ok) {
      let msg = body?.error?.message;
      try { const ctx = (fnErr as { context?: Response } | null)?.context; if (!msg && ctx) msg = (await ctx.json())?.error?.message; } catch { /* ignore */ }
      setBusy(false); return setError(msg ?? t("dsignup.failed"));
    }
    const { error: inErr } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    setBusy(false);
    navigate({ to: inErr ? "/auth" : "/tracker-connections", replace: true });
  }

  const field = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5"><Label htmlFor={`d-${k}`}>{label}</Label><Input id={`d-${k}`} value={f[k]} onChange={set(k)} {...extra} /></div>
  );
  return (
    <AuthCard title={t("dsignup.title")} subtitle={t("dsignup.subtitle")}>
      {error && <div className="mb-4"><Banner tone="danger" title={error} /></div>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {field("full_name", t("dsignup.name"), { autoComplete: "name" })}
        {field("specialty", t("dsignup.specialty"))}
        {field("clinic", t("dsignup.clinic"))}
        {field("phone", t("dsignup.phone"), { dir: "ltr", inputMode: "tel", placeholder: "03001234567" })}
        {field("email", t("dsignup.email"), { dir: "ltr", type: "email", autoComplete: "username" })}
        {field("pmdc_no", t("dsignup.pmdc"), { dir: "ltr" })}
        <div className="space-y-1.5">
          <Label htmlFor="d-cert">{t("dsignup.cert")}</Label>
          <Input id="d-cert" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {field("password", t("dsignup.password"), { type: "password", autoComplete: "new-password" })}
        <Button type="submit" className="w-full" disabled={busy}>{t("dsignup.submit")}</Button>
        <p className="text-center text-sm text-muted-foreground">{t("dsignup.haveAccount")} <Link to="/auth" className="text-primary underline">{t("dsignup.signIn")}</Link></p>
      </form>
    </AuthCard>
  );
}
