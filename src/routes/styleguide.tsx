import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/styleguide")({
  head: () => ({
    meta: [
      { title: "Styleguide — MediCore HMS" },
      { name: "description", content: "MediCore HMS design system: colours, type and every shared component in light and dark." },
      { property: "og:title", content: "Styleguide — MediCore HMS" },
      { property: "og:description", content: "Every MediCore HMS component in light and dark mode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Styleguide,
});

type Patient = { id: string; mrn: string; name: string; ward: string; bill: number; status: string };
const patients: Patient[] = [
  { id: "1", mrn: "IDM-000124", name: "Ayesha Khan", ward: "General", bill: 12500, status: "paid" },
  { id: "2", mrn: "IDM-000125", name: "Bilal Ahmed", ward: "ICU", bill: 86400, status: "unpaid" },
  { id: "3", mrn: "IDM-000126", name: "Fatima Raza", ward: "Maternity", bill: 34000, status: "partly" },
  { id: "4", mrn: "IDM-000127", name: "Hamza Siddiqui", ward: "General", bill: 4200, status: "paid" },
  { id: "5", mrn: "IDM-000128", name: "Zainab Malik", ward: "Paeds", bill: 0, status: "free" },
  { id: "6", mrn: "IDM-000129", name: "Usman Tariq", ward: "ICU", bill: 152300, status: "unpaid" },
  { id: "7", mrn: "IDM-000130", name: "Sana Iqbal", ward: "Maternity", bill: 21750, status: "paid" },
];
const billChip: Record<string, { s: "ok" | "urgent" | "warning"; l: string }> = {
  paid: { s: "ok", l: "Paid" }, free: { s: "ok", l: "Free" }, unpaid: { s: "urgent", l: "Unpaid" }, partly: { s: "warning", l: "Partly paid" },
};
const pkr = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const columns: Column<Patient>[] = [
  { key: "mrn", header: "MRN", sortable: true, render: (r) => <span className="ltr-code font-medium">{r.mrn}</span> },
  { key: "name", header: "Patient", sortable: true },
  { key: "ward", header: "Ward" },
  { key: "bill", header: "Bill", sortable: true, numeric: true, render: (r) => pkr(r.bill) },
  { key: "status", header: "Payment", render: (r) => <StatusChip status={billChip[r.status].s}>{billChip[r.status].l}</StatusChip> },
];

const ACCENTS = ["#16A34A", "#0D9488", "#2563EB", "#DC2626", "#9333EA"];

function Styleguide() {
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
              <p className="font-semibold leading-tight">MediCore HMS</p>
              <p className="text-xs text-muted-foreground">Design system</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Accent</span>
            {ACCENTS.map((c) => (
              <button key={c} aria-label={`Accent ${c}`} onClick={() => setBrand(c)} style={{ background: c }}
                className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition", accent === c && "ring-2 ring-foreground")} />
            ))}
            <input type="color" aria-label="Custom accent" value={accent} onChange={(e) => setBrand(e.target.value)}
              className="size-7 cursor-pointer rounded-full border bg-transparent" />
          </div>
        </div>
      </header>
      <Showcase mode="light" />
      <div className="dark"><Showcase mode="dark" /></div>
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

function Showcase({ mode }: { mode: "light" | "dark" }) {
  const [cnic, setCnic] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState<Date>();
  const [panel, setPanel] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const statuses = [
    ["urgent", "Urgent"], ["warning", "Warning"], ["caution", "Caution"], ["ok", "Done"], ["progress", "In progress"], ["inactive", "Inactive"],
  ] as const;

  return (
    <div className={cn("bg-background text-foreground", mode === "dark" && "border-t")}>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14">
        <div>
          <p className="text-sm font-medium text-primary">{mode === "light" ? "Light mode" : "Dark mode"}</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">Components</h2>
        </div>

        <Section title="Colour">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[["bg-primary", "Accent"], ["bg-urgent", "Urgent"], ["bg-warning", "Warning"], ["bg-caution", "Caution"], ["bg-ok", "OK"], ["bg-progress", "Progress"], ["bg-inactive", "Inactive"], ["bg-surface-sunken border", "Neutral"]].map(([c, l]) => (
              <div key={l} className="grid gap-2">
                <div className={cn("h-14 rounded-staff", c)} />
                <p className="text-xs text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-3"><div className="size-12 rounded-staff border bg-card" />Staff radius · 8px</div>
            <div className="flex items-center gap-3"><div className="size-12 rounded-patient border bg-card" />Patient radius · 16px</div>
          </div>
        </Section>

        <Section title="Type">
          <div className="grid gap-4 rounded-staff border bg-card p-6 shadow-card sm:grid-cols-2">
            <div>
              <p className="text-2xl font-semibold tracking-tight">Inter — Patient admissions</p>
              <p className="mt-1 tnum text-muted-foreground">Tabular: 1,204,560.00 · 0311 1111111</p>
            </div>
            <p dir="rtl" lang="ur" className="text-2xl">مریض کا داخلہ — خوش آمدید</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button><Plus />New patient</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger"><Trash2 />Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Form fields">
          <div className="grid gap-5 rounded-staff border bg-card p-6 shadow-card sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2"><Label>Full name</Label><Input placeholder="e.g. Ayesha Khan" /></div>
            <div className="grid gap-2"><Label>CNIC</Label><CnicInput value={cnic} onValueChange={setCnic} /></div>
            <div className="grid gap-2"><Label>Mobile</Label><PhoneInput value={phone} onValueChange={setPhone} /></div>
            <div className="grid gap-2">
              <Label>Department</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {["Emergency", "Cardiology", "Paediatrics", "Radiology"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>Admission date</Label><DatePicker value={date} onChange={setDate} /></div>
          </div>
        </Section>

        <Section title="Status chips">
          <div className="flex flex-wrap gap-2">
            {statuses.map(([s, l]) => <StatusChip key={s} status={s}>{l}</StatusChip>)}
          </div>
        </Section>

        <Section title="Stat cards">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="OPD visits today" value="248" trend={12} caption="vs yesterday" icon={Users} />
            <StatCard label="Beds occupied" value="86%" trend={-4} caption="of 120 beds" icon={BedDouble} goodWhen="down" />
            <StatCard label="Cash collected" value="Rs 412,300" trend={8} caption="this shift" icon={Banknote} />
            <StatCard label="Avg wait (min)" value="18" trend={0} caption="no change" icon={Activity} />
          </div>
        </Section>

        <Section title="Data table">
          <DataTable rows={patients} columns={columns} searchKeys={["name", "mrn"]}
            filters={[{ key: "ward", label: "Ward", options: ["General", "ICU", "Maternity", "Paeds"].map((v) => ({ value: v, label: v })) }]}
            bulkActions={() => <Button size="sm" variant="secondary">Print</Button>} />
        </Section>

        <Section title="Panels, dialogs and toasts">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setPanel(true)}>Open side panel</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>Cancel admission</Button>
            <Button variant="secondary" onClick={() => toast.success("Patient registered", { description: "MRN IDM-000131" })}>Success toast</Button>
            <Button variant="secondary" onClick={() => toast.error("Couldn't save", { description: "Check your connection and try again." })}>Error toast</Button>
          </div>
          <SidePanel open={panel} onOpenChange={setPanel} title="Ayesha Khan" description="MRN IDM-000124 · General ward"
            footer={<><Button variant="ghost" onClick={() => setPanel(false)}>Close</Button><Button>Save</Button></>}>
            <div className="grid gap-4">
              <div className="grid gap-2"><Label>Notes</Label><Input placeholder="Add a note" /></div>
              <StatusChip status="progress">Under observation</StatusChip>
            </div>
          </SidePanel>
          <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title="Cancel this admission?"
            description="The bed will be released. This action is recorded." confirmLabel="Cancel admission"
            onConfirm={(r) => toast(`Cancelled — reason: ${r}`)} />
        </Section>

        <Section title="Skeleton">
          <div className="grid gap-3 rounded-staff border bg-card p-6 shadow-card">
            <Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
          </div>
        </Section>

        <Section title="Empty state">
          <div className="rounded-staff border bg-card shadow-card">
            <EmptyState icon={FileX} title="No lab reports yet" description="Reports appear here once the lab uploads them." action={<Button size="sm"><Plus />Order test</Button>} />
          </div>
        </Section>

        <Section title="Banners">
          <div className="grid gap-3">
            <Banner tone="info" title="System update tonight at 2:00 AM">Expect a 5-minute pause.</Banner>
            <Banner tone="success" title="Shift closed">Cash reconciled with no difference.</Banner>
            <Banner tone="warning" title="Low stock: Paracetamol 500mg">12 strips left.</Banner>
            <Banner tone="danger" title="You're offline" onDismiss={() => {}}>Changes will sync when you reconnect.</Banner>
          </div>
        </Section>
      </div>
    </div>
  );
}
