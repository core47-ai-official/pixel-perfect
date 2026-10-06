import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PCard } from "@/components/mc/portal-shell";
import { FeedbackForm } from "@/components/mc/feedback-form";
import { callEdgeFunction } from "@/hooks/use-edge-function";

type Pending = { visit_id: string; completed_at: string; doctor_name: string | null } | null;

/** Portal Home card asking the patient to rate their latest completed visit (last 30 days, not yet rated). */
export function FeedbackPrompt() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState(false);
  const q = useQuery({
    queryKey: ["feedback-pending"],
    queryFn: () => callEdgeFunction<Pending>("submit-feedback", { action: "pending" }),
    retry: false,
  });
  if (hidden || !q.data) return null;
  return (
    <PCard className="space-y-2">
      <p className="text-lg font-semibold">{t("fb.promptTitle")}</p>
      <p className="text-sm text-muted-foreground">{q.data.doctor_name ? t("fb.promptBody", { doctor: q.data.doctor_name }) : t("fb.promptBodyNoDoc")}</p>
      <FeedbackForm visitId={q.data.visit_id} onDone={() => qc.invalidateQueries({ queryKey: ["feedback-pending"] })} />
      <Button variant="ghost" className="w-full" onClick={() => setHidden(true)}>{t("fb.later")}</Button>
    </PCard>
  );
}
