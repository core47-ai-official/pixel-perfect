/** Mirrors HA_FIELDS / HA_DEFAULTS in edge-functions/check-measurement-alerts.ts and save-health-alert-thresholds.ts. */
export const HA_FIELDS = [
  { key: "bp_sys_high", min: 100, max: 260, unit: "mmHg" },
  { key: "bp_sys_low", min: 50, max: 120, unit: "mmHg" },
  { key: "bp_dia_high", min: 60, max: 160, unit: "mmHg" },
  { key: "bp_dia_low", min: 30, max: 80, unit: "mmHg" },
  { key: "glucose_high", min: 120, max: 600, unit: "mg/dL" },
  { key: "glucose_low", min: 20, max: 100, unit: "mg/dL" },
  { key: "temp_high", min: 37, max: 45, unit: "°C" },
  { key: "temp_low", min: 30, max: 36, unit: "°C" },
  { key: "pulse_high", min: 80, max: 250, unit: "bpm" },
  { key: "pulse_low", min: 20, max: 70, unit: "bpm" },
  { key: "spo2_low", min: 50, max: 98, unit: "%" },
] as const;

export interface HealthAlert { key: string; side: "high" | "low"; threshold: number; value: number }
export interface HealthAlertResult { alerts: HealthAlert[]; hospital_phone: string | null }
