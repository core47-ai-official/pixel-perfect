import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WARD_TYPES } from "@/lib/beds";

export const TARIFF_CATEGORIES = ["consultation", "lab", "radiology", "room", "procedure", "ot", "pharmacy", "other"] as const;
export const ROOM_CLASSES = WARD_TYPES;
export const TARIFF_CSV_COLUMNS = ["code", "name", "category", "department", "room_class", "price", "is_active"] as const;

export interface Tariff { id: string; code: string; name: string; category: string; department_id: string | null; room_class: string | null; price: number; is_active: boolean }
export interface TariffPackage { id: string; name: string; description: string; price: number; tariff_codes: string[]; valid_days: number; is_active: boolean }

export function useTariffs() {
  return useQuery({ queryKey: ["tariffs"], queryFn: async () => {
    const { data, error } = await supabase.from("tariffs" as never).select("*").order("code");
    if (error) throw error;
    return ((data ?? []) as unknown as Tariff[]).map((x) => ({ ...x, price: Number(x.price) }));
  } });
}

export function usePackages() {
  return useQuery({ queryKey: ["packages"], queryFn: async () => {
    const { data, error } = await supabase.from("packages" as never).select("*").order("name");
    if (error) throw error;
    return ((data ?? []) as unknown as TariffPackage[]).map((x) => ({ ...x, price: Number(x.price) }));
  } });
}

/** Mirrors the server's checks so the import preview shows the same error rows. */
export function validateTariffRow(r: Record<string, string>, deptNames: Set<string>): string | null {
  const code = (r.code ?? "").trim();
  if (!code || !/^[A-Za-z0-9._\s-]+$/.test(code)) return "code";
  if ((r.name ?? "").trim().length < 2) return "name";
  if (!(TARIFF_CATEGORIES as readonly string[]).includes((r.category || "other").trim().toLowerCase())) return "category";
  const price = Number((r.price ?? "").replace(/,/g, ""));
  if (r.price === undefined || r.price.trim() === "" || !Number.isFinite(price) || price < 0) return "price";
  const rc = (r.room_class ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (rc && !(ROOM_CLASSES as readonly string[]).includes(rc)) return "roomClass";
  const dn = (r.department ?? "").trim().toLowerCase();
  if (dn && !deptNames.has(dn)) return "department";
  return null;
}

export const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
