import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PCard } from "@/components/mc/portal-shell";
import { NotificationSettings } from "@/components/mc/notification-settings";
import { PushPrompt } from "@/components/mc/push-prompt";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { supabase } from "@/integrations/supabase/client";
import { signOutEverywhere } from "@/lib/session";
import { usePreferences } from "@/lib/preferences";
import { useMyPatient } from "@/lib/portal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/portal/profile")({
  head: () => ({ meta: [{ title: "My profile — Patient portal" }, { name: "description", content: "Your language, notifications and password." }] }),
  component: Profile,
});

function Choice({ value, onChange, label, disabled }: { value: string; onChange: (v: "en" | "ur") => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-full border bg-card p-0.5 text-sm">
        {(["en", "ur"] as const).map((l) => (
          <button key={l} type="button" disabled={disabled} aria-pressed={value === l} onClick={() => onChange(l)}
            className={cn("rounded-full px-3 py-1", value === l ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            {l === "en" ? "English" : "اردو"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Profile() {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const me = useMyPatient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { language, setLanguage } = usePreferences();
  const [savingPrint, setSavingPrint] = useState(false);
  const login = context?.profile?.email ?? context?.profile?.phone ?? "";

  const setPrint = async (l: "en" | "ur") => {
    setSavingPrint(true);
    try { await callEdgeFunction("set-portal-preferences", { print_language: l }); await qc.invalidateQueries({ queryKey: ["portal"] }); toast.success(t("portal.profile.saved")); }
    catch (e) { toast.error((e as { message?: string })?.message ?? t("portal.profile.failed")); }
    finally { setSavingPrint(false); }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("portal.nav.profile")}</h1>
      <PCard className="space-y-1">
        <p className="text-lg font-semibold">{me.data?.full_name ?? context?.profile?.full_name}</p>
        {me.data && <p className="text-sm">MRN <Ltr>{me.data.mrn}</Ltr></p>}
        <p className="text-sm text-muted-foreground">{t("portal.login")}: <Ltr>{login}</Ltr></p>
        {!me.data && <p className="text-sm text-muted-foreground">{t("portal.notLinked")}</p>}
      </PCard>
      <PCard className="space-y-3">
        <Choice label={t("portal.profile.appLang")} value={language} onChange={setLanguage} />
        {me.data && <Choice label={t("portal.profile.printLang")} value={me.data.print_language === "ur" ? "ur" : "en"} onChange={(l) => void setPrint(l)} disabled={savingPrint} />}
        {me.data && <p className="text-xs text-muted-foreground">{t("portal.profile.printHint")}</p>}
      </PCard>
      <PCard className="space-y-3">
        <h2 className="font-semibold">{t("nset.tab")}</h2>
        <PushPrompt />
        <NotificationSettings />
      </PCard>
      <ChangePassword login={login} />
      <Button variant="outline" size="lg" className="w-full rounded-patient" onClick={() => void signOutEverywhere(qc, navigate)}>
        <LogOut aria-hidden />{t("auth.signOut")}
      </Button>
    </div>
  );
}

function ChangePassword({ login }: { login: string }) {
  const { t } = useTranslation();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw.length < 8) return setError(t("psignup.shortPassword"));
    if (pw !== pw2) return setError(t("psignup.mismatch"));
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const cred = u.user?.email ? { email: u.user.email, password: cur } : { phone: u.user?.phone ?? login, password: cur };
      const check = await supabase.auth.signInWithPassword(cred as { email: string; password: string });
      if (check.error) { setError(t("portal.profile.wrongCurrent")); return; }
      const { error: upd } = await supabase.auth.updateUser({ password: pw });
      if (upd) { setError(upd.message); return; }
      setCur(""); setPw(""); setPw2(""); toast.success(t("portal.profile.pwChanged"));
    } finally { setBusy(false); }
  };
  return (
    <PCard>
      <h2 className="mb-3 font-semibold">{t("portal.profile.changePw")}</h2>
      {error && <div className="mb-3"><Banner tone="danger" title={error} /></div>}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5"><Label htmlFor="pw-cur">{t("portal.profile.currentPw")}</Label>
          <Input id="pw-cur" type="password" autoComplete="current-password" className="rounded-patient" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw-new">{t("psignup.password")}</Label>
          <Input id="pw-new" type="password" autoComplete="new-password" className="rounded-patient" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw-new2">{t("psignup.confirm")}</Label>
          <Input id="pw-new2" type="password" autoComplete="new-password" className="rounded-patient" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        <Button type="submit" className="w-full rounded-patient" disabled={busy || !cur}>{t("portal.profile.changePw")}</Button>
      </form>
    </PCard>
  );
}
