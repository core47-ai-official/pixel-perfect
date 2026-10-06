import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FeedbackForm } from "@/components/mc/feedback-form";

export const Route = createFileRoute("/_authenticated/_app/feedback-kiosk")({
  head: () => ({ meta: [
    { title: "Feedback kiosk — MediCore HMS" },
    { name: "description", content: "Tablet mode for patients to rate their visit at reception." },
  ] }),
  component: () => <RequireRole roles={rolesForPage("feedbackKiosk")}><Kiosk /></RequireRole>,
});

function Kiosk() {
  const { t } = useTranslation();
  const [mrn, setMrn] = useState("");
  const [round, setRound] = useState(0);
  return (
    <div className="mx-auto max-w-lg space-y-5 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">{t("fb.kioskTitle")}</h1>
        <p className="text-muted-foreground">{t("fb.kioskHint")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="kiosk-mrn">{t("fb.mrnOptional")}</Label>
        <Input id="kiosk-mrn" dir="ltr" value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="MRN-2026-000001" />
      </div>
      <FeedbackForm key={round} mrn={mrn.trim()} onDone={() => { setMrn(""); setRound((r) => r + 1); }} />
    </div>
  );
}
