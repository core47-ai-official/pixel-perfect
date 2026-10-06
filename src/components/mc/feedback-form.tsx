import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { cn } from "@/lib/utils";

export const FEEDBACK_CATEGORIES = ["general", "doctor", "nursing", "cleanliness", "waiting_time", "billing", "pharmacy", "lab", "staff_behaviour", "other"] as const;

export function Stars({ value, onChange, size = "size-8" }: { value: number; onChange?: (n: number) => void; size?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1" dir="ltr" role={onChange ? "radiogroup" : undefined} aria-label={t("fb.rating")}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={cn(size, n <= value ? "fill-warning text-warning" : "text-muted-foreground")} aria-hidden />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={t("fb.stars", { n })} onClick={() => onChange(n)} className="rounded p-0.5 focus-visible:ring-2 focus-visible:ring-ring">{icon}</button>
        ) : <span key={n}>{icon}</span>;
      })}
    </div>
  );
}

/** Rating + comment form used by the patient portal and the reception kiosk; all rules live in submit-feedback. */
export function FeedbackForm({ visitId, mrn, onDone }: { visitId?: string; mrn?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [category, setCategory] = useState("general");
  const [complaint, setComplaint] = useState(false);
  const [busy, setBusy] = useState(false);
  const isComplaint = complaint || (rating > 0 && rating <= 2);
  const submit = async () => {
    setBusy(true);
    try {
      await callEdgeFunction("submit-feedback", { visit_id: visitId, mrn: mrn || undefined, rating, comment, category, is_complaint: isComplaint });
      toast.success(t("fb.thanks"));
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <Stars value={rating} onChange={setRating} />
      <div className="space-y-1">
        <Label>{t("fb.category")}</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{FEEDBACK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`fb.cat.${c}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="fb-comment">{isComplaint ? t("fb.whatWrong") : t("fb.comment")}</Label>
        <Textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isComplaint} disabled={rating > 0 && rating <= 2} onCheckedChange={(v) => setComplaint(v === true)} />
        {t("fb.isComplaint")}
      </label>
      <Button className="w-full" disabled={busy || rating === 0 || (isComplaint && comment.trim().length < 3)} onClick={submit}>{t("fb.submit")}</Button>
    </div>
  );
}
