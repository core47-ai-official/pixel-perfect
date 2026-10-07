/**
 * Notification types users see in their settings and admins template in company settings.
 * Mirrors NOTE_CRITICAL / NOTE_DEFAULTS in edge-functions/_shared/notify.ts and TYPES in save-notification-preferences.
 */
export interface NotificationTypeDef {
  id: string;
  critical?: boolean;
  /** Placeholders available in the company-settings template; omitted = fixed text (no template). */
  placeholders?: string[];
  defaults?: { en: string; ur: string };
}

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  { id: "appointment_booked", placeholders: ["patient", "doctor", "date", "time", "token"],
    defaults: { en: "Appointment confirmed\n{doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کنفرم\n{doctor} · {date} {time} · ٹوکن {token}" } },
  { id: "appointment_reminder", placeholders: ["patient", "doctor", "date", "time", "token", "hours"],
    defaults: { en: "Appointment reminder\nYou see {doctor} on {date} at {time} (token {token}).", ur: "اپائنٹمنٹ یاد دہانی\n{date} کو {time} بجے {doctor} سے ملاقات ہے (ٹوکن {token})۔" } },
  { id: "appointment_cancelled", placeholders: ["patient", "doctor", "date", "time", "reason"],
    defaults: { en: "Appointment cancelled\n{doctor} · {date} {time}. {reason}", ur: "اپائنٹمنٹ منسوخ\n{doctor} · {date} {time}۔ {reason}" } },
  { id: "appointment_rescheduled", placeholders: ["patient", "doctor", "date", "time", "token"],
    defaults: { en: "Appointment rescheduled\nNew time: {doctor} · {date} {time} · Token {token}", ur: "اپائنٹمنٹ کا وقت تبدیل\nنیا وقت: {doctor} · {date} {time} · ٹوکن {token}" } },
  { id: "appointment_needs_rebooking" },
  { id: "report_ready", placeholders: ["patient", "test"],
    defaults: { en: "Lab report ready\n{test} report for {patient} is ready.", ur: "لیب رپورٹ تیار\n{patient} کی {test} رپورٹ تیار ہے۔" } },
  { id: "critical_result", critical: true, placeholders: ["patient", "mrn", "test", "values"],
    defaults: { en: "URGENT: critical result — {patient}\n{test} (MRN {mrn}): {values}", ur: "فوری: خطرناک نتیجہ — {patient}\n{test} (ایم آر این {mrn}): {values}" } },
  { id: "leave_decision", placeholders: ["status", "from", "to", "note"],
    defaults: { en: "Leave {status}\n{from} to {to}. {note}", ur: "چھٹی {status}\n{from} سے {to}۔ {note}" } },
  { id: "approval_decision", placeholders: ["kind", "status", "invoice", "amount", "note"],
    defaults: { en: "{kind} request {status}\n{invoice} · Rs {amount}. {note}", ur: "{kind} درخواست {status}\n{invoice} · روپے {amount}۔ {note}" } },
  { id: "ot_bumped", critical: true, placeholders: ["procedure", "reason"],
    defaults: { en: "Your OT case was moved for an emergency\n{procedure}: {reason}", ur: "ایمرجنسی کی وجہ سے آپ کا آپریشن منتقل ہوا\n{procedure}: {reason}" } },
  { id: "stock_low", placeholders: ["count", "items"],
    defaults: { en: "{count} medicine(s) below reorder level\n{items}", ur: "{count} ادویات ری آرڈر حد سے کم\n{items}" } },
  { id: "stock_expiring" },
  { id: "followup_due", placeholders: ["patient", "date"],
    defaults: { en: "Follow-up visit tomorrow\nPlease visit the hospital on {date} for your follow-up after discharge.", ur: "کل فالو اپ معائنہ\nڈسچارج کے بعد فالو اپ کے لیے {date} کو ہسپتال تشریف لائیں۔" } },
  { id: "dose_reminder", placeholders: ["medicine", "dose", "time"],
    defaults: { en: "Time for your medicine\n{medicine} {dose} — whenever you are ready, tap to mark it.", ur: "دوا کا وقت\n{medicine} {dose} — جب آپ تیار ہوں، نشان لگانے کے لیے ٹیپ کریں۔" } },
  { id: "home_reading_alert", placeholders: ["patient", "measure", "reading", "date", "time"],
    defaults: { en: "Home reading outside alert level\n{patient}: {measure} {reading} on {date} {time}. For information.", ur: "گھریلو ریڈنگ الرٹ حد سے باہر\n{patient}: {measure} {reading}، {date} {time}۔ معلومات کے لیے۔" } },
];
