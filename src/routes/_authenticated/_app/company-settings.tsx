import { RoleDashboardsTab } from "@/components/mc/role-dashboards-tab";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Plus, Receipt, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { Banner } from "@/components/mc/banner";
import { HospitalLogo } from "@/components/mc/hospital-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ltr } from "@/components/mc/ltr";
import { NOTIFICATION_TYPES } from "@/config/notification-types";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SETTINGS_TABS, ASSET_RULES, contrastWithWhite, statusClash, isHex,
  type FieldDef, type TabDef, type TabValues, type Contact, type Holiday, type TabId,
} from "@/config/company-settings";
import { COMPANY_SETTINGS_KEY, useCompanySettings } from "@/hooks/use-company-settings";
import { callEdgeFunction, useEdgeFunction } from "@/hooks/use-edge-function";
import { useMyContext } from "@/hooks/use-my-context";

export const Route = createFileRoute("/_authenticated/_app/company-settings")({
  head: () => ({ meta: [{ title: "Company settings — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("companySettings")}>
      <CompanySettingsPage />
    </RequireRole>
  ),
});

const optKey = (o: string) => o.replace(/[/-]/g, "_");

function CompanySettingsPage() {
  const { t } = useTranslation();
  const { hasRole } = useMyContext();
  const { values, raw, isLoading, isError, error } = useCompanySettings();
  const canEdit = hasRole("super_admin") && raw?.can_edit !== false;
  const [tab, setTab] = useState<TabId>("general");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  useEffect(() => setAssetUrls(raw?.asset_urls ?? {}), [raw]);

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (isError) return <Banner tone="danger" title={t("cs.loadError")}>{(error as { message?: string })?.message}</Banner>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("cs.title")}</h1>
        <Button variant="secondary" onClick={() => setPreview(true)}><Receipt /> {t("cs.preview")}</Button>
      </div>
      {!canEdit && <Banner tone="info" title={t("cs.readOnly")} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-col gap-4 lg:flex-row">
        <TabsList className="flex h-auto flex-row flex-wrap justify-start gap-1 bg-transparent p-0 lg:w-56 lg:flex-col lg:items-stretch">
          {SETTINGS_TABS.map((tb) => (
            <TabsTrigger key={tb.id} value={tb.id} className="justify-start data-[state=active]:bg-muted data-[state=active]:shadow-none">
              {t(`cs.tabs.${tb.id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 flex-1">
          {SETTINGS_TABS.map((tb) => (
            <TabsContent key={tb.id} value={tb.id} className="mt-0">
              <div className="rounded-staff border bg-card p-5">
                {tb.kind === "fields" && (
                  <FieldsTab
                    key={JSON.stringify(values[tb.id])}
                    tab={tb}
                    initial={values[tb.id]}
                    canEdit={canEdit}
                    assetUrls={assetUrls}
                    onAssetUrl={(k, u) => setAssetUrls((m) => ({ ...m, [k]: u }))}
                  />
                )}
                {tb.kind === "contacts" && <ContactsTab key={JSON.stringify(raw?.contacts)} initial={raw?.contacts ?? []} canEdit={canEdit} />}
                {tb.kind === "dashboards" && <RoleDashboardsTab canEdit={canEdit} />}
                {tb.kind === "holidays" && <HolidaysTab key={JSON.stringify(raw?.holidays)} initial={raw?.holidays ?? []} canEdit={canEdit} />}
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
      <ReceiptPreview open={preview} onOpenChange={setPreview} values={values} logoUrl={assetUrls["logo"] ?? null} />
    </div>
  );
}

function useSaveTab() {
  const { t } = useTranslation();
  return useEdgeFunction("update-company-settings", { invalidate: [COMPANY_SETTINGS_KEY], successMessage: t("cs.saved") });
}

function SaveBar({ canEdit, busy, onSave }: { canEdit: boolean; busy: boolean; onSave: () => void }) {
  const { t } = useTranslation();
  if (!canEdit) return null;
  return (
    <div className="mt-6 flex justify-end border-t pt-4">
      <Button onClick={onSave} disabled={busy}>{busy ? t("cs.saving") : t("cs.save")}</Button>
    </div>
  );
}

function FieldsTab({
  tab, initial, canEdit, assetUrls, onAssetUrl,
}: { tab: TabDef; initial: TabValues; canEdit: boolean; assetUrls: Record<string, string>; onAssetUrl: (k: string, u: string) => void }) {
  const [vals, setVals] = useState<TabValues>(initial);
  const save = useSaveTab();
  const { t } = useTranslation();

  const onSave = () => {
    const bad = tab.fields.find((f) => f.type === "color" && !isHex(String(vals[f.key])));
    if (bad) { toast.error(t("cs.invalidColor")); return; }
    save.mutate({ tab: tab.id, values: vals });
  };

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        {tab.fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" || f.type === "color" || f.type === "asset" ? "md:col-span-2" : undefined}>
            <FieldInput
              field={f}
              value={vals[f.key] ?? f.default}
              disabled={!canEdit}
              onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
              assetUrl={assetUrls[f.key]}
              onAssetUrl={(u) => onAssetUrl(f.key, u)}
            />
          </div>
        ))}
      </div>
      <SaveBar canEdit={canEdit} busy={save.isPending} onSave={onSave} />
    </>
  );
}

function FieldInput({
  field: f, value, disabled, onChange, assetUrl, onAssetUrl,
}: {
  field: FieldDef; value: string | number | boolean; disabled: boolean;
  onChange: (v: string | number | boolean) => void; assetUrl?: string | undefined; onAssetUrl: (u: string) => void;
}) {
  const { t } = useTranslation();
  const id = `cs-${f.key}`;
  const label = <Label htmlFor={id}>{t(`cs.f.${f.key}`)}</Label>;

  if (f.type === "toggle")
    return (
      <div className="flex items-center justify-between gap-4 rounded-staff border p-3">
        {label}
        <Switch id={id} checked={!!value} disabled={disabled} onCheckedChange={onChange} />
      </div>
    );

  return (
    <div className="space-y-1.5">
      {label}
      {f.type === "text" && <Input id={id} dir={f.ltr ? "ltr" : undefined} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
      {f.type === "textarea" && <Textarea id={id} rows={3} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        dir={f.key.endsWith("_ur") ? "rtl" : f.ltr ? "ltr" : undefined} lang={f.key.endsWith("_ur") ? "ur" : undefined} />}
      {f.key.startsWith("tpl_") && <p className="text-xs text-muted-foreground">{t("cs.tplHint")} <Ltr className="font-mono">{(NOTIFICATION_TYPES.find((n) => f.key === `tpl_${n.id}_en` || f.key === `tpl_${n.id}_ur`)?.placeholders ?? []).map((x) => `{${x}}`).join(" ")}</Ltr></p>}
      {f.type === "number" && (
        <Input id={id} type="number" dir="ltr" className="tnum" value={String(value)} min={f.min} max={f.max} disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
      )}
      {f.type === "time" && <Input id={id} type="time" dir="ltr" value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
      {f.type === "select" && (
        <Select value={String(value)} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}><SelectValue /></SelectTrigger>
          <SelectContent>
            {f.options!.map((o) => <SelectItem key={o} value={o}>{t(`cs.o.${optKey(o)}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {f.type === "color" && <ColorField id={id} value={String(value)} disabled={disabled} onChange={onChange} />}
      {f.type === "asset" && <AssetField kind={f.asset!} value={String(value)} url={assetUrl} disabled={disabled} onChange={onChange} onUrl={onAssetUrl} />}
    </div>
  );
}

function ColorField({ id, value, disabled, onChange }: { id: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const ratio = contrastWithWhite(value);
  const clash = statusClash(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input type="color" aria-label={t("cs.f.accent_color")} value={isHex(value) ? value : "#16A34A"} disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded-staff border bg-background p-1" />
        <Input id={id} dir="ltr" className="ltr-code w-36" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <span className="rounded-staff px-3 py-2 text-sm font-medium" style={{ background: isHex(value) ? value : undefined, color: "#fff" }}>Aa</span>
      </div>
      {ratio === null ? (
        <p className="text-sm text-urgent-fg">{t("cs.invalidColor")}</p>
      ) : (
        <p className={`flex items-center gap-1.5 text-sm ${ratio >= 4.5 ? "text-ok-fg" : "text-urgent-fg"}`}>
          {ratio >= 4.5 ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
          <span>{t("cs.contrast", { ratio: ratio.toFixed(2) })} — {t(ratio >= 4.5 ? "cs.contrastOk" : "cs.contrastLow")}</span>
        </p>
      )}
      {clash && (
        <p className="flex items-center gap-1.5 text-sm text-warning-fg">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {t(clash === "red" ? "cs.clashRed" : "cs.clashAmber")}
        </p>
      )}
    </div>
  );
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function AssetField({
  kind, value, url, disabled, onChange, onUrl,
}: { kind: keyof typeof ASSET_RULES; value: string; url?: string | undefined; disabled: boolean; onChange: (v: string) => void; onUrl: (u: string) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const rule = ASSET_RULES[kind];
  const types = rule.types.map((x) => x.split("/")[1]!.replace("svg+xml", "svg").replace("vnd.microsoft.icon", "ico").replace("x-icon", "ico").toUpperCase());
  const sizeLabel = rule.maxBytes >= 1024 * 1024 ? `${rule.maxBytes / 1024 / 1024} MB` : `${rule.maxBytes / 1024} KB`;

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > rule.maxBytes || !rule.types.includes(file.type)) {
      toast.error(t("cs.badFile", { types: [...new Set(types)].join(", "), size: sizeLabel }));
      return;
    }
    setBusy(true);
    try {
      const res = await callEdgeFunction<{ path: string; url: string }>("upload-company-asset", {
        kind, filename: file.name, content_type: file.type, data_base64: await readBase64(file),
      });
      onChange(res.path);
      onUrl(res.url);
      toast.success(t("cs.uploaded"));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-staff border p-3">
      <div className="grid size-16 place-items-center overflow-hidden rounded-staff bg-muted">
        {value && url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">{t("cs.noFile")}</span>}
      </div>
      <p className="flex-1 text-xs text-muted-foreground">{t("cs.badFile", { types: [...new Set(types)].join(", "), size: sizeLabel })}</p>
      {!disabled && (
        <div className="flex gap-2">
          <Button asChild variant="secondary" size="sm" disabled={busy}>
            <label className="cursor-pointer">
              <Upload /> {busy ? t("cs.uploading") : value ? t("cs.replace") : t("cs.upload")}
              <input type="file" className="sr-only" accept={rule.types.join(",")} disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Button>
          {value && <Button variant="ghost" size="sm" onClick={() => onChange("")}>{t("cs.remove")}</Button>}
        </div>
      )}
    </div>
  );
}

function ContactsTab({ initial, canEdit }: { initial: Contact[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Contact[]>(initial);
  const save = useSaveTab();
  const upd = (i: number, patch: Partial<Contact>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setPrimary = (i: number) => setRows((r) => r.map((x, j) => (x.type === r[i]!.type ? { ...x, is_primary: j === i } : x)));
  return (
    <>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("cs.noContacts")}</p>}
      <div className="space-y-2">
        {rows.map((c, i) => (
          <div key={c.id ?? i} className="grid items-center gap-2 rounded-staff border p-2 sm:grid-cols-[8rem_1fr_1.5fr_auto_auto]">
            <Select value={c.type} disabled={!canEdit} onValueChange={(v) => upd(i, { type: v as Contact["type"], is_primary: false })}>
              <SelectTrigger aria-label={t("cs.type")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="phone">{t("cs.phone")}</SelectItem>
                <SelectItem value="email">{t("cs.email")}</SelectItem>
              </SelectContent>
            </Select>
            <Input aria-label={t("cs.label")} placeholder={t("cs.label")} value={c.label} disabled={!canEdit} onChange={(e) => upd(i, { label: e.target.value })} />
            <Input aria-label={t("cs.value")} dir="ltr" className="ltr-code" placeholder={c.type === "email" ? "info@hospital.pk" : "+92 42 1234567"} value={c.value} disabled={!canEdit} onChange={(e) => upd(i, { value: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={c.is_primary} disabled={!canEdit} onCheckedChange={() => setPrimary(i)} />{t("cs.primary")}</label>
            {canEdit && <Button variant="ghost" size="icon" aria-label={t("cs.remove")} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 /></Button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setRows((r) => [...r, { type: "phone", label: "", value: "", is_primary: !r.some((x) => x.type === "phone") }])}>
          <Plus /> {t("cs.addContact")}
        </Button>
      )}
      <SaveBar canEdit={canEdit} busy={save.isPending} onSave={() => {
        if (rows.some((r) => !r.value.trim())) { toast.error(t("cs.invalidRows")); return; }
        save.mutate({ tab: "contacts", contacts: rows });
      }} />
    </>
  );
}

function HolidaysTab({ initial, canEdit }: { initial: Holiday[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Holiday[]>([...initial].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
  const save = useSaveTab();
  const upd = (i: number, patch: Partial<Holiday>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("cs.noHolidays")}</p>}
      <div className="space-y-2">
        {rows.map((h, i) => (
          <div key={h.id ?? i} className="grid items-center gap-2 rounded-staff border p-2 sm:grid-cols-[11rem_1fr_auto_auto]">
            <Input type="date" dir="ltr" aria-label={t("cs.date")} value={h.holiday_date} disabled={!canEdit} onChange={(e) => upd(i, { holiday_date: e.target.value })} />
            <Input aria-label={t("cs.name")} placeholder={t("cs.name")} value={h.name} disabled={!canEdit} onChange={(e) => upd(i, { name: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={h.is_recurring} disabled={!canEdit} onCheckedChange={(c) => upd(i, { is_recurring: !!c })} />{t("cs.recurring")}</label>
            {canEdit && <Button variant="ghost" size="icon" aria-label={t("cs.remove")} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 /></Button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setRows((r) => [...r, { holiday_date: "", name: "", is_recurring: false }])}>
          <Plus /> {t("cs.addHoliday")}
        </Button>
      )}
      <SaveBar canEdit={canEdit} busy={save.isPending} onSave={() => {
        if (rows.some((r) => !r.holiday_date || !r.name.trim())) { toast.error(t("cs.invalidRows")); return; }
        save.mutate({ tab: "holidays", holidays: rows });
      }} />
    </>
  );
}

function ReceiptPreview({
  open, onOpenChange, values, logoUrl,
}: { open: boolean; onOpenChange: (o: boolean) => void; values: ReturnType<typeof useCompanySettings>["values"]; logoUrl: string | null }) {
  const { t } = useTranslation();
  const g = values.general, b = values.billing, p = values.printing;
  const paper = String(p["receipt_paper"]);
  const width = paper === "thermal80" ? "w-[300px]" : paper === "a5" ? "w-[420px]" : "w-[520px]";
  const items: [string, number][] = [[t("cs.sampleItem1"), 1500], [t("cs.sampleItem2"), 850]];
  const total = items.reduce((s, [, v]) => s + v, 0);
  const pkr = (n: number) => `Rs ${n.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-fit">
        <DialogHeader><DialogTitle>{t("cs.sampleReceipt")}</DialogTitle></DialogHeader>
        <div className={`mx-auto ${width} space-y-3 rounded-md border bg-white p-5 font-mono text-xs text-neutral-900`} dir="ltr">
          <div className="space-y-1 text-center">
            {p["show_logo"] && <HospitalLogo src={logoUrl} className="mx-auto size-12" />}
            <div className="text-sm font-bold">{String(g["hospital_name"]) || "IDMPak Hospital"}</div>
            {g["address"] && <div>{String(g["address"])}{g["city"] ? `, ${String(g["city"])}` : ""}</div>}
            {p["header_text"] && <div className="whitespace-pre-wrap">{String(p["header_text"])}</div>}
          </div>
          <div className="border-t border-dashed border-neutral-400 pt-2">
            <div>{t("cs.receiptNo")}: {String(b["receipt_prefix"])}000123</div>
            <div>{t("cs.patient")}: Ahmed Raza · MRN-000045</div>
            <div>{new Date().toLocaleString("en-PK")}</div>
          </div>
          <div className="space-y-1 border-t border-dashed border-neutral-400 pt-2">
            {items.map(([n, v]) => <div key={n} className="flex justify-between gap-4"><span>{n}</span><span>{pkr(v)}</span></div>)}
            <div className="flex justify-between gap-4 border-t border-neutral-400 pt-1 font-bold"><span>{t("cs.total")}</span><span>{pkr(total)}</span></div>
            <div>{t("cs.paidCash")}</div>
          </div>
          {(b["receipt_footer"] || p["footer_text"]) && (
            <div className="whitespace-pre-wrap border-t border-dashed border-neutral-400 pt-2 text-center">
              {String(b["receipt_footer"] || "")}{p["footer_text"] ? `\n${String(p["footer_text"])}` : ""}
            </div>
          )}
        </div>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>{t("cs.close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

