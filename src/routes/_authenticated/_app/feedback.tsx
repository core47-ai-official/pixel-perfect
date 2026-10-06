import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { callEdgeFunction } from "@/hooks/use-edge-function";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip } from "@/components/mc/status-chip";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { Stars, FEEDBACK_CATEGORIES } from "@/components/mc/feedback-form";
import { useDepartmentsData } from "@/lib/departments-data";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app/feedback")({
  head: () => ({ meta: [
    { title: "Feedback & complaints — MediCore HMS" },
    { name: "description", content: "Patient ratings and complaints with assignment, resolution and department averages." },
  ] }),
  component: () => <RequireRole roles={rolesForPage("feedback")}><FeedbackPage /></RequireRole>,
});

interface Fb {
  id: string; rating: number; comment: string | null; category: string; is_complaint: boolean; status: string; channel: string;
  department_id: string | null; assigned_to: string | null; resolution: string | null; resolved_at: string | null; created_at: string;
  patient: { full_name: string; mrn: string } | null;
}
type Row = Fb & { patient_name: string; dept_name: string; kind: string; date: string; assignee: string };

const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" });

function FeedbackPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  const { depts } = useDepartmentsData();
  const [open, setOpen] = useState<Row | null>(null);
  const list = useQuery({
    queryKey: ["feedback", hid], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("feedback")
        .select("id, rating, comment, category, is_complaint, status, channel, department_id, assigned_to, resolution, resolved_at, created_at, patient:patients(full_name, mrn)")
        .order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as unknown as Fb[];
    },
  });
  const staff = useQuery({
    queryKey: ["feedback-staff", hid], enabled: !!hid,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
  const deptName = useMemo(() => new Map((depts.data ?? []).map((d) => [d.id, d.name])), [depts.data]);
  const staffName = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.full_name])), [staff.data]);
  const rows: Row[] = (list.data ?? []).map((f) => ({
    ...f, patient_name: f.patient?.full_name ?? t("fb.anonymous"), dept_name: f.department_id ? deptName.get(f.department_id) ?? "—" : t("fb.noDept"),
    kind: f.is_complaint ? "complaint" : "feedback", date: f.created_at, assignee: f.assigned_to ? staffName.get(f.assigned_to) ?? "—" : "—",
  }));
  const avg = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; open: number }>();
    for (const r of rows) {
      const e = m.get(r.dept_name) ?? { sum: 0, n: 0, open: 0 };
      e.sum += r.rating; e.n++; if (r.is_complaint && r.status !== "resolved") e.open++;
      m.set(r.dept_name, e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const overall = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
  const openComplaints = rows.filter((r) => r.is_complaint && r.status !== "resolved").length;
  const tone = (s: string) => (s === "resolved" ? "ok" : s === "in_progress" ? "progress" : "warning") as const;

  const columns: Column<Row>[] = [
    { key: "date", header: t("fb.date"), sortable: true, render: (r) => <Ltr>{fmt(r.date)}</Ltr> },
    { key: "rating", header: t("fb.rating"), sortable: true, render: (r) => <Stars value={r.rating} size="size-4" /> },
    { key: "kind", header: t("fb.type"), render: (r) => r.is_complaint ? <StatusChip status="urgent">{t("fb.complaint")}</StatusChip> : t("fb.feedback") },
    { key: "category", header: t("fb.category"), render: (r) => t(`fb.cat.${r.category}`) },
    { key: "dept_name", header: t("fb.department"), sortable: true },
    { key: "patient_name", header: t("fb.patient") },
    { key: "status", header: t("fb.status"), render: (r) => <StatusChip status={tone(r.status)}>{t(`fb.st.${r.status}`)}</StatusChip> },
    { key: "assignee", header: t("fb.assignedTo") },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("fb.title")}</h1>
      {list.isError && <Banner tone="danger" title={t("fb.loadFailed")} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{t("fb.avgOverall")}</p><p className="text-2xl font-semibold"><Ltr>{overall.toFixed(1)}</Ltr> / 5</p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{t("fb.total")}</p><p className="text-2xl font-semibold"><Ltr>{rows.length}</Ltr></p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{t("fb.openComplaints")}</p><p className="text-2xl font-semibold text-urgent-fg"><Ltr>{openComplaints}</Ltr></p></div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 font-medium">{t("fb.byDept")}</h2>
        {avg.length === 0 ? <p className="text-sm text-muted-foreground">{t("fb.none")}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground"><th className="text-start">{t("fb.department")}</th><th className="text-end">{t("fb.avg")}</th><th className="text-end">{t("fb.count")}</th><th className="text-end">{t("fb.openComplaints")}</th></tr></thead>
            <tbody>{avg.map(([d, e]) => (
              <tr key={d} className="border-t"><td className="py-1.5">{d}</td><td className="text-end"><Ltr>{(e.sum / e.n).toFixed(1)}</Ltr></td><td className="text-end"><Ltr>{e.n}</Ltr></td><td className="text-end"><Ltr>{e.open}</Ltr></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <DataTable rows={rows} columns={columns} pageSize={15} searchKeys={["patient_name", "comment", "dept_name"]}
        filters={[
          { key: "status", label: t("fb.status"), options: ["open", "in_progress", "resolved"].map((s) => ({ value: s, label: t(`fb.st.${s}`) })) },
          { key: "kind", label: t("fb.type"), options: [{ value: "complaint", label: t("fb.complaint") }, { value: "feedback", label: t("fb.feedback") }] },
          { key: "rating", label: t("fb.rating"), options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: t("fb.stars", { n }) })) },
          { key: "category", label: t("fb.category"), options: FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: t(`fb.cat.${c}`) })) },
          { key: "dept_name", label: t("fb.department"), options: [...new Set(rows.map((r) => r.dept_name))].map((d) => ({ value: d, label: d })) },
        ]} />
      <p className="text-xs text-muted-foreground">{t("fb.openHint")}</p>
      <div className="space-y-2">
        {rows.filter((r) => r.status !== "resolved").slice(0, 20).map((r) => (
          <button key={r.id} onClick={() => setOpen(r)} className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-start hover:bg-accent">
            <span className="min-w-0"><span className="block truncate font-medium">{r.comment || t(`fb.cat.${r.category}`)}</span><span className="text-xs text-muted-foreground">{r.patient_name} · {r.dept_name} · <Ltr>{fmt(r.date)}</Ltr></span></span>
            <span className="flex shrink-0 items-center gap-2"><Stars value={r.rating} size="size-3.5" /><StatusChip status={tone(r.status)}>{t(`fb.st.${r.status}`)}</StatusChip></span>
          </button>
        ))}
      </div>
      {open && <Detail row={open} staff={staff.data ?? []} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["feedback"] }); }} />}
    </div>
  );
}

function Detail({ row, staff, onClose, onChanged }: { row: Row; staff: { id: string; full_name: string }[]; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [assignee, setAssignee] = useState(row.assigned_to ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: string, body: object) => {
    setBusy(true);
    try { await callEdgeFunction(fn, body); toast.success(t("fb.saved")); onChanged(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={row.is_complaint ? t("fb.complaint") : t("fb.feedback")}>
      <div className="space-y-4">
        <Stars value={row.rating} size="size-5" />
        <p className="text-sm">{row.comment || "—"}</p>
        <p className="text-xs text-muted-foreground">{row.patient_name}{row.patient?.mrn ? <> · <Ltr>{row.patient.mrn}</Ltr></> : null} · {row.dept_name} · {t(`fb.ch.${row.channel}`)}</p>
        {row.status === "resolved" ? (
          <Banner tone="success" title={t("fb.resolvedOn", { date: row.resolved_at ? fmt(row.resolved_at) : "" })}>{row.resolution}</Banner>
        ) : (
          <>
            <div className="space-y-1">
              <Label>{t("fb.assignedTo")}</Label>
              <div className="flex gap-2">
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger><SelectValue placeholder={t("fb.pickStaff")} /></SelectTrigger>
                  <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" disabled={busy || !assignee || assignee === row.assigned_to} onClick={() => run("assign-feedback", { id: row.id, assigned_to: assignee })}>{t("fb.assign")}</Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fb-res">{t("fb.resolution")}</Label>
              <Textarea id="fb-res" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <Button className="w-full" disabled={busy || note.trim().length < 3} onClick={() => run("resolve-feedback", { id: row.id, resolution: note })}>{t("fb.resolve")}</Button>
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}
