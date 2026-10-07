/**
 * Company settings schema: tabs, fields, defaults and which fields are public
 * (returned to every staff member by get-company-settings). The settings page
 * renders entirely from this file.
 */
import { NOTIFICATION_TYPES } from "@/config/notification-types";

export type FieldType = "text" | "textarea" | "number" | "select" | "toggle" | "time" | "color" | "asset";
export type AssetKind = "logo" | "mono_logo" | "favicon" | "signature" | "stamp";

export interface FieldDef {
  key: string;
  type: FieldType;
  default: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
  asset?: AssetKind;
  public?: boolean;
  ltr?: boolean;
}

export type TabId =
  | "general" | "branding" | "contacts" | "localization" | "security" | "opd" | "appointments" | "billing"
  | "pharmacy" | "lab" | "wards" | "emergency" | "printing" | "notifications" | "holidays" | "patient_portal" | "health_tracker" | "dashboards" | "demo";

export interface TabDef {
  id: TabId;
  /** Stored in company_settings column of the same name; contacts/holidays use their own tables. */
  kind: "fields" | "contacts" | "holidays" | "dashboards" | "health_tracker" | "demo";
  fields: FieldDef[];
}

export const SETTINGS_TABS: TabDef[] = [
  { id: "general", kind: "fields", fields: [
    { key: "hospital_name", type: "text", default: "", public: true },
    { key: "legal_name", type: "text", default: "" },
    { key: "registration_no", type: "text", default: "", ltr: true },
    { key: "ntn", type: "text", default: "", ltr: true },
    { key: "address", type: "textarea", default: "", public: true },
    { key: "city", type: "text", default: "", public: true },
    { key: "province", type: "select", default: "punjab", public: true, options: ["punjab", "sindh", "kpk", "balochistan", "ict", "gb", "ajk"] },
    { key: "website", type: "text", default: "", public: true, ltr: true },
    { key: "is_live", type: "toggle", default: false },
  ] },
  { id: "branding", kind: "fields", fields: [
    { key: "logo", type: "asset", asset: "logo", default: "", public: true },
    { key: "mono_logo", type: "asset", asset: "mono_logo", default: "", public: true },
    { key: "favicon", type: "asset", asset: "favicon", default: "", public: true },
    { key: "accent_color", type: "color", default: "#16A34A", public: true },
  ] },
  { id: "contacts", kind: "contacts", fields: [] },
  { id: "localization", kind: "fields", fields: [
    { key: "default_language", type: "select", default: "en", options: ["en", "ur"], public: true },
    { key: "default_print_language", type: "select", default: "en", options: ["en", "ur"], public: true },
    { key: "date_format", type: "select", default: "DD/MM/YYYY", options: ["DD/MM/YYYY", "DD-MMM-YYYY", "YYYY-MM-DD"], public: true },
    { key: "week_start", type: "select", default: "monday", options: ["monday", "sunday"], public: true },
  ] },
  { id: "security", kind: "fields", fields: [
    { key: "session_timeout_minutes", type: "number", default: 30, min: 5, max: 240, public: true },
    { key: "password_min_length", type: "number", default: 8, min: 8, max: 32 },
    { key: "max_failed_logins", type: "number", default: 5, min: 3, max: 20 },
    { key: "impersonation_enabled", type: "toggle", default: true },
  ] },
  { id: "opd", kind: "fields", fields: [
    { key: "opd_start", type: "time", default: "09:00", public: true },
    { key: "opd_end", type: "time", default: "17:00", public: true },
    { key: "slot_minutes", type: "number", default: 15, min: 5, max: 120 },
    { key: "token_reset", type: "select", default: "daily", options: ["daily", "never"] },
    { key: "consultation_fee", type: "number", default: 0, min: 0 },
    { key: "avg_consult_minutes", type: "number", default: 10, min: 1, max: 120 },
    { key: "tv_display_token", type: "text", default: "", ltr: true },
  ] },
  { id: "appointments", kind: "fields", fields: [
    { key: "booking_window_days", type: "number", default: 30, min: 1, max: 365 },
    { key: "cancellation_hours", type: "number", default: 2, min: 0, max: 72 },
    { key: "allow_walk_ins", type: "toggle", default: true },
    { key: "allow_patient_booking", type: "toggle", default: false },
  ] },
  { id: "billing", kind: "fields", fields: [
    { key: "invoice_prefix", type: "text", default: "INV-", ltr: true },
    { key: "receipt_prefix", type: "text", default: "RCP-", ltr: true },
    { key: "round_to", type: "select", default: "1", options: ["1", "5", "10"] },
    { key: "max_discount_percent", type: "number", default: 10, min: 0, max: 100 },
    { key: "max_discount_receptionist", type: "number", default: 0, min: 0, max: 100 },
    { key: "max_discount_er_officer", type: "number", default: 0, min: 0, max: 100 },
    { key: "receipt_footer", type: "textarea", default: "Thank you. Get well soon." },
  ] },
  { id: "pharmacy", kind: "fields", fields: [
    { key: "low_stock_days", type: "number", default: 7, min: 1, max: 90 },
    { key: "expiry_warning_days", type: "number", default: 60, min: 7, max: 365 },
    { key: "allow_sale_without_prescription", type: "toggle", default: false },
  ] },
  { id: "lab", kind: "fields", fields: [
    { key: "require_verification", type: "toggle", default: true },
    { key: "default_turnaround_hours", type: "number", default: 24, min: 1, max: 240 },
    { key: "report_footer", type: "textarea", default: "" },
  ] },
  { id: "wards", kind: "fields", fields: [
    { key: "visiting_hours", type: "text", default: "16:00–19:00", public: true },
    { key: "discharge_time", type: "time", default: "12:00" },
    { key: "bed_charge_cutoff", type: "time", default: "12:00" },
  ] },
  { id: "emergency", kind: "fields", fields: [
    { key: "triage_scale", type: "select", default: "esi5", options: ["esi5", "mts", "simple3"] },
    { key: "er_registration_fee", type: "number", default: 0, min: 0 },
    { key: "treat_before_payment", type: "toggle", default: true },
  ] },
  { id: "printing", kind: "fields", fields: [
    { key: "receipt_paper", type: "select", default: "thermal80", options: ["thermal80", "a5", "a4"] },
    { key: "show_logo", type: "toggle", default: true },
    { key: "header_text", type: "textarea", default: "" },
    { key: "footer_text", type: "textarea", default: "" },
    { key: "bilingual_layout", type: "select", default: "stacked", options: ["stacked", "side_by_side"] },
    { key: "show_qr", type: "toggle", default: true },
    { key: "signature", type: "asset", asset: "signature", default: "" },
    { key: "stamp", type: "asset", asset: "stamp", default: "" },
  ] },
  { id: "notifications", kind: "fields", fields: [
    { key: "push_enabled", type: "toggle", default: true },
    { key: "in_app_enabled", type: "toggle", default: true },
    { key: "low_stock_alerts", type: "toggle", default: true },
    { key: "critical_lab_alerts", type: "toggle", default: true },
    { key: "reminder_first_hours", type: "number", default: 24, min: 0, max: 168 },
    { key: "reminder_second_hours", type: "number", default: 2, min: 0, max: 48 },
    ...NOTIFICATION_TYPES.filter((n) => n.defaults).flatMap((n): FieldDef[] => [
      { key: `tpl_${n.id}_en`, type: "textarea", default: n.defaults!.en, ltr: true },
      { key: `tpl_${n.id}_ur`, type: "textarea", default: n.defaults!.ur },
    ]),
  ] },
  { id: "holidays", kind: "holidays", fields: [] },
  { id: "patient_portal", kind: "fields", fields: [
    { key: "portal_enabled", type: "toggle", default: false, public: true },
    { key: "show_bills", type: "toggle", default: true },
    { key: "show_lab_results", type: "toggle", default: true },
    { key: "welcome_message", type: "textarea", default: "" },
  ] },
  { id: "health_tracker", kind: "health_tracker", fields: [] },
  { id: "dashboards", kind: "dashboards", fields: [] },
  { id: "demo", kind: "demo", fields: [] },
];

export type TabValues = Record<string, string | number | boolean>;
export type SettingsValues = Partial<Record<TabId, TabValues>>;

export interface Contact { id?: string; type: "email" | "phone"; label: string; value: string; is_primary: boolean }
export interface Holiday { id?: string; holiday_date: string; name: string; is_recurring: boolean }

export interface CompanySettingsResponse {
  settings: SettingsValues;
  /** Signed URLs for asset fields, keyed by field key (e.g. "logo"). */
  asset_urls?: Record<string, string>;
  contacts: Contact[];
  holidays: Holiday[];
  can_edit: boolean;
}

/** Fill every tab with defaults for anything missing. */
export function withDefaults(s: SettingsValues | undefined): Record<TabId, TabValues> {
  const out = {} as Record<TabId, TabValues>;
  for (const tab of SETTINGS_TABS) {
    const saved = s?.[tab.id] ?? {};
    out[tab.id] = Object.fromEntries(tab.fields.map((f) => [f.key, saved[f.key] ?? f.default]));
  }
  return out;
}

export const ASSET_RULES: Record<AssetKind, { maxBytes: number; types: string[] }> = {
  logo: { maxBytes: 1024 * 1024, types: ["image/png", "image/svg+xml", "image/jpeg", "image/webp"] },
  mono_logo: { maxBytes: 1024 * 1024, types: ["image/png", "image/svg+xml"] },
  favicon: { maxBytes: 256 * 1024, types: ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"] },
  signature: { maxBytes: 512 * 1024, types: ["image/png"] },
  stamp: { maxBytes: 512 * 1024, types: ["image/png"] },
};

/* ---------- accent colour checks ---------- */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function contrastWithWhite(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05);
}

/** "red" / "amber" when the hue is close to a status colour, else null. */
export function statusClash(hex: string): "red" | "amber" | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return null;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < 0.35) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 345 || h < 18) return "red";
  if (h >= 25 && h < 55) return "amber";
  return null;
}

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
