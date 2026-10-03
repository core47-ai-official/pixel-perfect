import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { StatusChip, type Status } from "@/components/mc/status-chip";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";
import { useDepartmentsData, type Doc } from "@/lib/departments-data";

export const Route = createFileRoute("/_authenticated/_app/doctors")({
  head: () => ({ meta: [{ title: "Doctors — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("doctors")}>
      <DoctorsPage />
    </RequireRole>
  ),
});

const STATUSES = ["available", "in_opd", "in_surgery", "on_round", "on_leave", "off_duty"] as const;
const STATUS_TONE: Record<string, Status> = {
  available: "ok", in_opd: "progress", in_surgery: "urgent", on_round: "caution", on_leave: "warning", off_duty: "inactive",
};
const GENDERS = ["male", "female", "other"] as const;
type Row = Doc & { name: string; deptName: string };
const pkr = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

function DoctorsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const canEdit = hasRole("super_admin") || hasRole("admin");
  const { depts, doctors, people } = useDepartmentsData();
  const [editing, setEditing] = useState<Doc | "new" | null>(null);

  const rows: Row[] = (doctors.data ?? []).map((d) => ({
    ...d,
    name: people.data?.find((p) => p.id === d.user_id)?.full_name ?? "—",
    deptName: depts.data?.find((x) => x.id === d.department_id)?.name ?? "—",
  }));
  const columns: Column<Row>[] = [
    { key: "name", header: t("doc.name"), sortable: true, render: (d) => <span className="font-medium">{d.name}</span> },
    { key: "deptName", header: t("doc.department"), sortable: true },
    { key: "specialty", header: t("doc.specialty"), sortable: true, render: (d) => d.specialty || "—" },
    { key: "gender", header: t("doc.gender"), render: (d) => (d.gender ? t(`doc.genders.${d.gender}`) : "—") },
    { key: "consultation_fee", header: t("doc.fee"), numeric: true, sortable: true, render: (d) => <Ltr className="tnum">{pkr(d.consultation_fee)}</Ltr> },
    { key: "status", header: t("doc.status"), sortable: true, render: (d) => <StatusChip status={STATUS_TONE[d.status]}>{t(`doc.statuses.${d.status}`)}</StatusChip> },
  ];
  if (canEdit) columns.push({ key: "id", header: "", render: (d) => <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{t("dept.editShort")}</Button> });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("doc.intro")}</p>
        {canEdit && <Button onClick={() => setEditing("new")}><Plus className="size-4" />{t("doc.add")}</Button>}
      </div>
      {doctors.isLoading ? <Skeleton className="h-64 w-full" /> : doctors.isError ? (
        <p className="text-sm text-destructive">{t("doc.loadError")}</p>
      ) : (
        <DataTable rows={rows} columns={columns} searchKeys={["name", "specialty", "deptName"]}
          filters={[
            { key: "department_id", label: t("doc.department"), options: (depts.data ?? []).map((d) => ({ value: d.id, label: d.name })) },
            { key: "status", label: t("doc.status"), options: STATUSES.map((s) => ({ value: s, label: t(`doc.statuses.${s}`) })) },
          ]} />
      )}
      {editing && (
        <DoctorForm key={editing === "new" ? "new" : editing.id} target={editing} onClose={() => setEditing(null)}
          depts={depts.data ?? []}
          people={(people.data ?? []).filter((p) => editing !== "new" || !rows.some((r) => r.user_id === p.id))} />
      )}
    </div>
  );
}

function DoctorForm({ target, onClose, depts, people }: {
  target: Doc | "new"; onClose: () => void; depts: { id: string; name: string }[]; people: { id: string; full_name: string }[];
}) {
  const { t } = useTranslation();
  const d = target === "new" ? null : target;
  const [userId, setUserId] = useState(d?.user_id ?? "");
  const [dept, setDept] = useState(d?.department_id ?? "");
  const [specialty, setSpecialty] = useState(d?.specialty ?? "");
  const [gender, setGender] = useState(d?.gender ?? "");
  const [langs, setLangs] = useState((d?.languages ?? ["en", "ur"]).join(", "));
  const [fee, setFee] = useState(d ? String(d.consultation_fee) : "");
  const [fu, setFu] = useState(d ? String(d.followup_fee) : "");
  const [pmdc, setPmdc] = useState(d?.pmdc_no ?? "");
  const [status, setStatus] = useState(d?.status ?? "off_duty");
  const save = useEdgeFunction("upsert-doctor-profile", { invalidate: [["doctors"], ["departments"]], successMessage: t("doc.saved") });

  const submit = () => {
    if (!userId || !dept) { toast.error(t("doc.required")); return; }
    const f = Number(fee || 0), g = Number(fu || 0);
    if (!(f >= 0) || !(g >= 0)) { toast.error(t("doc.badFee")); return; }
    save.mutate({
      user_id: userId, department_id: dept, specialty: specialty.trim(), gender: gender || null,
      languages: langs.split(",").map((s) => s.trim()).filter(Boolean),
      consultation_fee: f, followup_fee: g, pmdc_no: pmdc.trim() || null, status,
    }, { onSuccess: onClose });
  };

  const field = (label: string, el: React.ReactNode) => <div className="space-y-1.5"><Label>{label}</Label>{el}</div>;
  return (
    <SidePanel open onOpenChange={(o) => !o && onClose()} title={d ? t("doc.edit") : t("doc.add")}
      footer={<div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t("dept.cancel")}</Button>
        <Button onClick={submit} disabled={save.isPending}>{t("dept.save")}</Button>
      </div>}>
      <div className="space-y-4">
        {field(t("doc.person"), (
          <Select value={userId} onValueChange={setUserId} disabled={!!d}>
            <SelectTrigger><SelectValue placeholder={t("doc.pickPerson")} /></SelectTrigger>
            <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}</SelectContent>
          </Select>
        ))}
        {field(t("doc.department"), (
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger><SelectValue placeholder={t("doc.pickDept")} /></SelectTrigger>
            <SelectContent>{depts.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
          </Select>
        ))}
        {field(t("doc.specialty"), <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={120} />)}
        {field(t("doc.gender"), (
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g}>{t(`doc.genders.${g}`)}</SelectItem>)}</SelectContent>
          </Select>
        ))}
        {field(t("doc.languages"), <Input dir="ltr" value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="en, ur, pa" />)}
        <div className="grid grid-cols-2 gap-3">
          {field(t("doc.fee"), <Input dir="ltr" inputMode="decimal" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />)}
          {field(t("doc.followupFee"), <Input dir="ltr" inputMode="decimal" type="number" min={0} step="0.01" value={fu} onChange={(e) => setFu(e.target.value)} />)}
        </div>
        {field(t("doc.pmdc"), <Input dir="ltr" value={pmdc} onChange={(e) => setPmdc(e.target.value)} maxLength={30} />)}
        {field(t("doc.status"), (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`doc.statuses.${s}`)}</SelectItem>)}</SelectContent>
          </Select>
        ))}
      </div>
    </SidePanel>
  );
}
