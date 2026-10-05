import { ReceiptText, Package as PackageIcon } from "lucide-react";
import { Hourglass,
  LayoutDashboard, NotebookPen, Users, CalendarDays, ListOrdered, Stethoscope, BedDouble, HeartPulse, Siren, Scissors,
  FlaskConical, Pill, Boxes, Receipt, Wallet, UserCog, Building2, BarChart3, ScrollText, Settings, LifeBuoy,
  CalendarCheck, FileHeart, FileText, UserPlus, CalendarPlus, ClipboardPlus, TestTube, ShoppingCart, ClipboardList, BadgePlus, BadgeCheck, PiggyBank,
  Ambulance, UsersRound, BriefcaseMedical, Radio, CalendarOff, CalendarCheck2, OctagonAlert, Ticket, SlidersHorizontal, Sun, CalendarRange, BookMarked, TestTubes, type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/hooks/use-my-context";

/** Single source of truth for staff navigation, quick-add buttons and role access. */

export type NavGroup = "overview" | "patients" | "clinical" | "diagnostics" | "finance" | "admin" | "myHealth";

export interface NavPage {
  id: string;
  path: string;
  icon: LucideIcon;
  group: NavGroup;
}

export const GROUP_ORDER: NavGroup[] = ["overview", "patients", "clinical", "diagnostics", "finance", "admin", "myHealth"];

export const PAGES = {
  dashboard: { id: "dashboard", path: "/dashboard", icon: LayoutDashboard, group: "overview" },
  patients: { id: "patients", path: "/patients", icon: Users, group: "patients" },
  appointments: { id: "appointments", path: "/appointments", icon: CalendarDays, group: "patients" },
  doctorsNow: { id: "doctorsNow", path: "/doctors-now", icon: Radio, group: "patients" },
  myDay: { id: "myDay", path: "/my-day", icon: Sun, group: "overview" },
  mySchedule: { id: "mySchedule", path: "/my-schedule", icon: CalendarRange, group: "clinical" },
  opdQueue: { id: "opdQueue", path: "/opd-queue", icon: ListOrdered, group: "patients" },
  consultations: { id: "consultations", path: "/consultations", icon: Stethoscope, group: "clinical" },
  myLeave: { id: "myLeave", path: "/my-leave", icon: CalendarOff, group: "clinical" },
  wards: { id: "wards", path: "/wards", icon: BedDouble, group: "clinical" },
  nursing: { id: "nursing", path: "/nursing", icon: HeartPulse, group: "clinical" },
  handover: { id: "handover", path: "/handover", icon: NotebookPen, group: "clinical" },
  emergency: { id: "emergency", path: "/emergency", icon: Siren, group: "clinical" },
  ot: { id: "ot", path: "/ot", icon: Scissors, group: "clinical" },
  lab: { id: "lab", path: "/lab", icon: FlaskConical, group: "diagnostics" },
  pharmacy: { id: "pharmacy", path: "/pharmacy", icon: Pill, group: "diagnostics" },
  tariffs: { id: "tariffs", path: "/tariffs", icon: ReceiptText, group: "finance" },
  packages: { id: "packages", path: "/packages", icon: PackageIcon, group: "finance" },
  formulary: { id: "formulary", path: "/formulary", icon: BookMarked, group: "diagnostics" },
  wardSetup: { id: "wardSetup", path: "/ward-setup", icon: BedDouble, group: "admin" },
  labTests: { id: "labTests", path: "/lab-tests", icon: TestTubes, group: "diagnostics" },
  inventory: { id: "inventory", path: "/inventory", icon: Boxes, group: "diagnostics" },
  purchaseRequests: { id: "purchaseRequests", path: "/purchase-requests", icon: ClipboardList, group: "diagnostics" },
  billing: { id: "billing", path: "/billing", icon: Receipt, group: "finance" },
  approvals: { id: "approvals", path: "/approvals", icon: BadgeCheck, group: "finance" },
  cashRegister: { id: "cashRegister", path: "/cash-register", icon: Wallet, group: "finance" },
  unpaid: { id: "unpaid", path: "/unpaid", icon: Hourglass, group: "finance" },
  users: { id: "users", path: "/users", icon: UsersRound, group: "admin" },
  staff: { id: "staff", path: "/staff", icon: UserCog, group: "admin" },
  departments: { id: "departments", path: "/departments", icon: Building2, group: "admin" },
  doctors: { id: "doctors", path: "/doctors", icon: BriefcaseMedical, group: "admin" },
  leaveApprovals: { id: "leaveApprovals", path: "/leave-approvals", icon: CalendarCheck2, group: "admin" },
  reports: { id: "reports", path: "/reports", icon: BarChart3, group: "admin" },
  auditLogs: { id: "auditLogs", path: "/audit-logs", icon: ScrollText, group: "admin" },
  companySettings: { id: "companySettings", path: "/company-settings", icon: SlidersHorizontal, group: "admin" },
  systemIssues: { id: "systemIssues", path: "/system-issues", icon: OctagonAlert, group: "admin" },
  supportTickets: { id: "supportTickets", path: "/support-tickets", icon: Ticket, group: "admin" },
  myAppointments: { id: "myAppointments", path: "/my-appointments", icon: CalendarCheck, group: "myHealth" },
  myRecords: { id: "myRecords", path: "/my-records", icon: FileHeart, group: "myHealth" },
  myBills: { id: "myBills", path: "/my-bills", icon: FileText, group: "myHealth" },
} satisfies Record<string, NavPage>;

export type PageId = keyof typeof PAGES;

/** Pinned near the bottom of the sidebar for everyone. */
export const FOOTER_PAGES: NavPage[] = [
  { id: "settings", path: "/settings", icon: Settings, group: "admin" },
  { id: "help", path: "/help", icon: LifeBuoy, group: "admin" },
];

/** Role → pages, in priority order (first four become the mobile bottom nav). */
export const ROLE_PAGES: Record<AppRole, PageId[]> = {
  super_admin: ["dashboard", "users", "reports", "auditLogs", "systemIssues", "supportTickets", "companySettings", "departments", "doctors", "doctorsNow", "leaveApprovals", "ot", "patients", "appointments", "billing", "approvals", "cashRegister", "unpaid", "inventory", "purchaseRequests", "formulary", "labTests", "wardSetup", "wards", "emergency", "nursing", "handover", "tariffs", "packages"],
  admin: ["dashboard", "users", "departments", "doctors", "doctorsNow", "leaveApprovals", "companySettings", "reports", "patients", "appointments", "ot", "billing", "approvals", "unpaid", "inventory", "purchaseRequests", "formulary", "labTests", "wardSetup", "wards", "emergency", "nursing", "handover", "tariffs", "packages"],
  dept_head: ["dashboard", "consultations", "wards", "emergency", "nursing", "handover", "reports", "patients", "appointments", "staff", "doctors", "doctorsNow", "leaveApprovals"],
  doctor: ["myDay", "opdQueue", "mySchedule", "patients", "consultations", "appointments", "ot", "myLeave", "wards", "emergency", "lab", "formulary", "dashboard"],
  nurse: ["nursing", "wards", "handover", "patients", "emergency", "dashboard"],
  er_officer: ["dashboard", "emergency", "patients", "wards", "lab"],
  ot_coordinator: ["dashboard", "ot", "patients", "wards", "inventory"],
  receptionist: ["dashboard", "patients", "doctorsNow", "appointments", "opdQueue", "billing", "approvals", "wards", "emergency", "tariffs", "packages"],
  pharmacist: ["dashboard", "pharmacy", "formulary", "inventory", "purchaseRequests", "patients"],
  lab_tech: ["dashboard", "lab", "labTests", "patients", "inventory"],
  cashier: ["dashboard", "billing", "approvals", "cashRegister", "unpaid", "patients", "tariffs", "packages"],
  patient: ["dashboard", "myAppointments", "myRecords", "myBills"],
};

export interface QuickAction {
  id: string;
  icon: LucideIcon;
}

export const QUICK_ACTIONS = {
  newPatient: { id: "newPatient", icon: UserPlus },
  newAppointment: { id: "newAppointment", icon: CalendarPlus },
  newAdmission: { id: "newAdmission", icon: ClipboardPlus },
  newLabOrder: { id: "newLabOrder", icon: TestTube },
  newSale: { id: "newSale", icon: ShoppingCart },
  newReceipt: { id: "newReceipt", icon: BadgePlus },
  newDeposit: { id: "newDeposit", icon: PiggyBank },
  newEmergency: { id: "newEmergency", icon: Ambulance },
  newStaff: { id: "newStaff", icon: UserCog },
  newOtBooking: { id: "newOtBooking", icon: Scissors },
  newDispense: { id: "newDispense", icon: Pill },
  newSample: { id: "newSample", icon: TestTube },
} satisfies Record<string, QuickAction>;

export type QuickActionId = keyof typeof QUICK_ACTIONS;

export const ROLE_QUICK_ADD: Record<AppRole, QuickActionId[]> = {
  super_admin: ["newStaff"],
  admin: ["newStaff", "newPatient", "newAppointment", "newAdmission", "newReceipt"],
  dept_head: ["newAppointment"],
  doctor: ["newAppointment", "newLabOrder", "newAdmission", "newOtBooking"],
  nurse: ["newAdmission"],
  er_officer: ["newEmergency", "newPatient"],
  ot_coordinator: ["newOtBooking"],
  receptionist: ["newPatient", "newAppointment", "newAdmission", "newEmergency"],
  pharmacist: ["newDispense", "newSale"],
  lab_tech: ["newSample", "newLabOrder"],
  cashier: ["newReceipt", "newDeposit"],
  patient: [],
};

function union<T>(lists: T[][]): T[] {
  const seen = new Set<T>();
  for (const l of lists) for (const x of l) seen.add(x);
  return [...seen];
}

/** Union of pages for all of a user's roles, keeping the first role's priority order. */
export function pagesForRoles(roles: AppRole[]): NavPage[] {
  return union(roles.map((r) => ROLE_PAGES[r] ?? [])).map((id) => PAGES[id]);
}

export function quickActionsForRoles(roles: AppRole[]): QuickAction[] {
  return union(roles.map((r) => ROLE_QUICK_ADD[r] ?? [])).map((id) => QUICK_ACTIONS[id]);
}

export function rolesForPage(id: string): AppRole[] {
  return (Object.keys(ROLE_PAGES) as AppRole[]).filter((r) => (ROLE_PAGES[r] as string[]).includes(id));
}

export function findPage(pathname: string): NavPage | undefined {
  return [...Object.values(PAGES), ...FOOTER_PAGES].find((p) => pathname === p.path || pathname.startsWith(p.path + "/"));
}
