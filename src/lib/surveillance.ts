// Mirrors SURV_GROUPS in get-surveillance-report / get-widget-data.
export const SURV_GROUPS = ["dengue", "malaria", "typhoid", "hepatitis", "tb", "measles", "heatstroke"] as const;
export type SurvGroup = (typeof SURV_GROUPS)[number];
export const SURV_CODES: Record<SurvGroup, string> = {
  dengue: "A90–A91, A97", malaria: "B50–B54", typhoid: "A01", hepatitis: "B15–B19", tb: "A15–A19", measles: "B05", heatstroke: "T67",
};
export interface SurvWeek { end: string; count: number; baseline: number; surge: boolean }
export interface SurvReport {
  from: string; to: string; groups: SurvGroup[];
  daily: ({ day: string } & Partial<Record<SurvGroup, number>>)[];
  totals: Partial<Record<SurvGroup, number>>;
  weeks: Record<SurvGroup, SurvWeek[]>;
  surges: { group: SurvGroup; week_end: string; count: number; baseline: number; pct: number }[];
  districts: ({ district: string; total: number } & Partial<Record<SurvGroup, number>>)[];
  ages: ({ age: string; total: number } & Partial<Record<SurvGroup, number>>)[];
}
