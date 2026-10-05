import { Activity, BedDouble, FileText, FlaskConical, FolderOpen, LayoutGrid, Pill, Receipt, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/hooks/use-my-context";

/** Single source of truth for which patient-profile tabs each role can see. */
export type PatientTabId = "overview" | "visits" | "prescriptions" | "lab" | "admissions" | "bills" | "documents";

const CLINICAL: AppRole[] = ["super_admin", "admin", "dept_head", "doctor", "nurse", "er_officer"];

export const PATIENT_TABS: { id: PatientTabId; icon: LucideIcon; roles: AppRole[] }[] = [
  { id: "overview", icon: LayoutGrid, roles: [...CLINICAL, "ot_coordinator", "receptionist", "pharmacist", "lab_tech", "cashier"] },
  { id: "visits", icon: Activity, roles: [...CLINICAL, "receptionist"] },
  { id: "prescriptions", icon: Pill, roles: [...CLINICAL, "pharmacist"] },
  { id: "lab", icon: FlaskConical, roles: [...CLINICAL, "lab_tech"] },
  { id: "admissions", icon: BedDouble, roles: [...CLINICAL, "ot_coordinator", "receptionist"] },
  { id: "bills", icon: Receipt, roles: ["super_admin", "admin", "cashier", "receptionist"] },
  { id: "documents", icon: FolderOpen, roles: [...CLINICAL, "ot_coordinator", "receptionist", "lab_tech", "cashier"] },
];

/** Roles allowed to see money (balance due in the patient header). */
export const BALANCE_ROLES: AppRole[] = ["super_admin", "admin", "cashier", "receptionist", "dept_head", "doctor", "er_officer", "pharmacist"];

export function tabsForRoles(roles: AppRole[]) {
  return PATIENT_TABS.filter((t) => t.roles.some((r) => roles.includes(r)));
}
export const TAB_ICON_FALLBACK = FileText;
