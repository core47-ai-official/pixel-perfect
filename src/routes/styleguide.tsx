import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Activity, BedDouble, Banknote, FileX, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CnicInput, PhoneInput } from "@/components/mc/masked-input";
import { DatePicker } from "@/components/mc/date-picker";
import { StatusChip } from "@/components/mc/status-chip";
import { StatCard } from "@/components/mc/stat-card";
import { DataTable, type Column } from "@/components/mc/data-table";
import { SidePanel } from "@/components/mc/side-panel";
import { ConfirmDialog } from "@/components/mc/confirm-dialog";
import { EmptyState } from "@/components/mc/empty-state";
import { Banner } from "@/components/mc/banner";
import { Ltr } from "@/components/mc/ltr";
import { PreferenceControls } from "@/components/mc/preference-controls";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/styleguide")({
  head: () => ({
    meta: [
      { title: "Styleguide — MediCore HMS" },
      { name: "description", content: "MediCore HMS design system: colours, type and every shared component in light and dark, English and Urdu." },
      { property: "og:title", content: "Styleguide — MediCore HMS" },
      { property: "og:description", content: "Every MediCore HMS component in light and dark mode, English and Urdu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Styleguide,
});

type Patient = { id: string; mrn: string; name: string; ward: string; bill: number; status: string };
const RAW: Omit<Patient, "name">[] = [
  { id: "1", mrn: "IDM-000124", ward: "General", bill: 12500, status: "paid" },
  { id: "2", mrn: "IDM-000125", ward: "ICU", bill: 86400, status: "unpaid" },
  { id: "3", mrn: "IDM-000126", ward: "Maternity", bill: 34000, status: "partly" },
  { id: "4", mrn: "IDM-000127", ward: "General", bill: 4200, status: "paid" },
  { id: "5", mrn: "IDM-000128", ward: "Paeds", bill: 0, status: "free" },
  { id: "6", mrn: "IDM-000129", ward: "ICU", bill: 152300, status: "unpaid" },
  { id: "7", mrn: "IDM-000130", ward: "Maternity", bill: 21750, status: "paid" },
];
const WARDS = ["General", "ICU", "Maternity", "Paeds"];
const PAY_STATUS: Record<string, "ok" | "urgent" | "warning"> = { paid: "ok", free: "ok", unpaid: "urgent", partly: "warning" };
const pkr = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const ACCENTS = ["#16A34A", "#0D9488", "#2563EB", "#DC2626", "#9333EA"];

function Styleguide() {
  const { t } = useTranslation();
  const { theme } = usePreferences();
  const [accent, setAccent] = useState("#16A34A");
  const setBrand = (c: string) => {
    setAccent(c);
    document.documentElement.style.setProperty("--brand", c);
  };
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-staff bg-primary text-primary-foreground"><Activity className="size-5" /></span>
            <div>
              <p className="font-semibold leading-tight">{t("app.name")}</p>
              <p className="text-xs text-muted-foreground">{t("app.designSystem")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <PreferenceControls />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("prefs.accent")}</span>
              {ACCENTS.map((c) => (
                <button key={c} aria-label={`${t("prefs.accent")} ${c}`} onClick={() => setBrand(c)} style={{ background: c }}
                  className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition", accent === c && "ring-2 ring-foreground")} />
              ))}
              <input type="color" aria-label={t("prefs.customAccent")} value={accent} onChange={(e) => setBrand(e.target.value)}
                className="size-7 cursor-pointer rounded-full border bg-transparent" />
            </div>
          </div>
        </div>
      </header>
      <Showcase label={theme === "dark" ? t("sg.darkMode") : t("sg.lightMode")} />
      {theme === "light" && <div className="dark"><Showcase label={t("sg.darkMode")} divided /></div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Showcase({ label, divided }: { label: string; divided?: boolean }) {
  const { t } = useTranslation();
  const [cnic, setCnic] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState<Date>();
  const [panel, setPanel] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const rows = useMemo<Patient[]>(() => RAW.map((r) => ({ ...r, name: t(`sg.names.${r.id}`) })), [t]);
  const columns = useMemo<Column<Patient>[]>(() => [
    { key: "mrn", header: t("sg.col.mrn"), sortable: true, render: (r) => <Ltr className="font-medium">{r.mrn}</Ltr> },
    { key: "name", header: t("sg.col.patient"), sortable: true },
    { key: "ward", header: t("sg.col.ward"), render: (r) => t(`sg.ward.${r.ward}`) },
    { key: "bill", header: t("sg.col.bill"), sortable: true, numeric: true, render: (r) => <Ltr>{pkr(r.bill)}</Ltr> },
    { key: "status", header: t("sg.col.payment"), render: (r) => <StatusChip status={PAY_STATUS[r.status] ?? "inactive"}>{t(`sg.pay.${r.status}`)}</StatusChip> },
  ], [t]);

  const statuses = [
    ["urgent", "urgent"], ["warning", "warning"], ["caution", "caution"], ["ok", "done"], ["progress", "progress"], ["inactive", "inactive"],
  ] as const;
  const swatches = [
    ["bg-primary", "accent"], ["bg-urgent", "urgent"], ["bg-warning", "warning"], ["bg-caution", "caution"],
    ["bg-ok", "ok"], ["bg-progress", "progress"], ["bg-inactive", "inactive"], ["bg-surface-sunken border", "neutral"],
  ] as const;

  return (
    <div className={cn("bg-background text-foreground", divided && "border-t")}>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14">
        <div>
          <p className="text-sm font-medium text-primary">{label}</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">{t("sg.components")}</h2>
        </div>

        <Section title={t("sg.colour")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {swatches.map(([c, k]) => (
              <div key={k} className="grid gap-2">
                <div className={cn("h-14 rounded-staff", c)} />
                <p className="text-xs text-muted-foreground">{t(`sg.swatch.${k}`)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-3"><div className="size-12 rounded-staff border bg-card" />{t("sg.staffRadius")} · <Ltr>8px</Ltr></div>
            <div className="flex items-center gap-3"><div className="size-12 rounded-patient border bg-card" />{t("sg.patientRadius")} · <Ltr>16px</Ltr></div>
          </div>
        </Section>

        <Section title={t("sg.type")}>
          <div className="grid gap-4 rounded-staff border bg-card p-6 shadow-card sm:grid-cols-2">
            <div>
              <p className="text-2xl font-semibold tracking-tight"><Ltr>Inter</Ltr> — {t("sg.typeSample")}</p>
              <p className="mt-1 text-muted-foreground">{t("sg.tabular")}: <Ltr>1,204,560.00 · 0311 1111111</Ltr></p>
            </div>
            <p dir="rtl" lang="ur" className="text-2xl">{t("sg.urduSample")}</p>
          </div>
        </Section>

        <Section title={t("sg.buttons")}>
          <div className="flex flex-wrap gap-3">
            <Button><Plus />{t("sg.btn.newPatient")}</Button>
            <Button variant="secondary">{t("sg.btn.secondary")}</Button>
            <Button variant="ghost">{t("sg.btn.ghost")}</Button>
            <Button variant="danger"><Trash2 />{t("sg.btn.delete")}</Button>
            <Button disabled>{t("sg.btn.disabled")}</Button>
          </div>
        </Section>

        <Section title={t("sg.formFields")}>
          <div className="grid gap-5 rounded-staff border bg-card p-6 shadow-card sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2"><Label>{t("sg.field.fullName")}</Label><Input placeholder={t("sg.field.fullNamePh")} /></div>
            <div className="grid gap-2"><Label>{t("sg.field.cnic")}</Label><CnicInput value={cnic} onValueChange={setCnic} /></div>
            <div className="grid gap-2"><Label>{t("sg.field.mobile")}</Label><PhoneInput value={phone} onValueChange={setPhone} /></div>
            <div className="grid gap-2">
              <Label>{t("sg.field.department")}</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder={t("sg.field.departmentPh")} /></SelectTrigger>
                <SelectContent>
                  {(["emergency", "cardiology", "paediatrics", "radiology"] as const).map((d) => <SelectItem key={d} value={d}>{t(`sg.dept.${d}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>{t("sg.field.admissionDate")}</Label><DatePicker value={date} onChange={setDate} /></div>
          </div>
        </Section>

        <Section title={t("sg.statusChips")}>
          <div className="flex flex-wrap gap-2">
            {statuses.map(([s, k]) => <StatusChip key={s} status={s}>{t(`sg.status.${k}`)}</StatusChip>)}
          </div>
        </Section>

        <Section title={t("sg.statCards")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("sg.stat.opd")} value="248" trend={12} caption={t("sg.stat.vsYesterday")} icon={Users} />
            <StatCard label={t("sg.stat.beds")} value="86%" trend={-4} caption={t("sg.stat.ofBeds", { n: 120 })} icon={BedDouble} goodWhen="down" />
            <StatCard label={t("sg.stat.cash")} value="Rs 412,300" trend={8} caption={t("sg.stat.thisShift")} icon={Banknote} />
            <StatCard label={t("sg.stat.wait")} value="18" trend={0} caption={t("sg.stat.noChange")} icon={Activity} />
          </div>
        </Section>

        <Section title={t("sg.dataTable")}>
          <DataTable rows={rows} columns={columns} searchKeys={["name", "mrn"]}
            filters={[{ key: "ward", label: t("sg.col.ward"), options: WARDS.map((v) => ({ value: v, label: t(`sg.ward.${v}`) })) }]}
            bulkActions={() => <Button size="sm" variant="secondary">{t("common.print")}</Button>} />
        </Section>

        <Section title={t("sg.overlays")}>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setPanel(true)}>{t("sg.openPanel")}</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>{t("sg.cancelAdmission")}</Button>
            <Button variant="secondary" onClick={() => toast.success(t("sg.registered"), { description: "MRN IDM-000131" })}>{t("sg.successToast")}</Button>
            <Button variant="secondary" onClick={() => toast.error(t("sg.saveFailed"), { description: t("sg.saveFailedDesc") })}>{t("sg.errorToast")}</Button>
          </div>
          <SidePanel open={panel} onOpenChange={setPanel} title={t("sg.names.1")} description={`MRN IDM-000124 · ${t("sg.panelDesc")}`}
            footer={<><Button variant="ghost" onClick={() => setPanel(false)}>{t("common.close")}</Button><Button>{t("common.save")}</Button></>}>
            <div className="grid gap-4">
              <div className="grid gap-2"><Label>{t("sg.notes")}</Label><Input placeholder={t("sg.notesPh")} /></div>
              <StatusChip status="progress">{t("sg.observation")}</StatusChip>
            </div>
          </SidePanel>
          <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title={t("sg.confirmTitle")}
            description={t("sg.confirmDesc")} confirmLabel={t("sg.cancelAdmission")}
            onConfirm={(r) => toast(t("sg.cancelledWith", { reason: r }))} />
        </Section>

        <Section title={t("sg.skeleton")}>
          <div className="grid gap-3 rounded-staff border bg-card p-6 shadow-card">
            <Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
          </div>
        </Section>

        <Section title={t("sg.emptyState")}>
          <div className="rounded-staff border bg-card shadow-card">
            <EmptyState icon={FileX} title={t("sg.noLab")} description={t("sg.noLabDesc")} action={<Button size="sm"><Plus />{t("sg.orderTest")}</Button>} />
          </div>
        </Section>

        <Section title={t("sg.banners")}>
          <div className="grid gap-3">
            <Banner tone="info" title={t("sg.b.infoT")}>{t("sg.b.infoD")}</Banner>
            <Banner tone="success" title={t("sg.b.okT")}>{t("sg.b.okD")}</Banner>
            <Banner tone="warning" title={t("sg.b.warnT")}>{t("sg.b.warnD")}</Banner>
            <Banner tone="danger" title={t("sg.b.dangerT")} onDismiss={() => {}}>{t("sg.b.dangerD")}</Banner>
          </div>
        </Section>
      </div>
    </div>
  );
}
