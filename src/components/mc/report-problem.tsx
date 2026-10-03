import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "./side-panel";
import { Ltr } from "./ltr";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";

const MAX = 5 * 1024 * 1024;

/** "Report a problem" form: captures the current page and an optional screenshot (private "tickets" bucket). */
export function ReportProblemPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { context } = useMyContext();
  const location = useRouterState({ select: (s) => s.location });
  const page = location.pathname + (location.searchStr ?? "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setText(""); setFile(null); };

  async function submit() {
    if (text.trim().length < 10) { toast.error(t("report.tooShort")); return; }
    if (file && (file.size > MAX || !file.type.startsWith("image/"))) { toast.error(t("report.tooBig")); return; }
    setBusy(true);
    try {
      let screenshot_path: string | null = null;
      const hospitalId = context?.hospital?.id;
      const userId = context?.profile?.id;
      if (file && hospitalId && userId) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${hospitalId}/${userId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("tickets").upload(path, file, { contentType: file.type });
        if (error) throw error;
        screenshot_path = path;
      }
      await callEdgeFunction("create-support-ticket", { page, description: text.trim(), screenshot_path });
      toast.success(t("report.sent"));
      reset();
      onOpenChange(false);
    } catch {
      toast.error(t("report.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={t("report.title")}
      description={t("report.body")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("users.cancel")}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? t("report.sending") : t("report.submit")}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("report.page")}</Label>
          <p className="rounded-staff bg-muted px-3 py-2 text-sm"><Ltr>{page}</Ltr></p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-text">{t("report.description")}</Label>
          <Textarea id="report-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("report.descriptionHint")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-file">{t("report.screenshot")}</Label>
          <Input id="report-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">{t("report.screenshotHint")}</p>
        </div>
      </div>
    </SidePanel>
  );
}
