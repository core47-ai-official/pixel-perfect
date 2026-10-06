import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PortalPatient { id: string; full_name: string; mrn: string; phone: string | null; dob: string | null; gender: string | null; print_language: string | null }

/** The signed-in patient's own linked record (RLS: patients.user_id = auth.uid()); null until linked. */
export const myPatientQuery = queryOptions({
  queryKey: ["portal", "me"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const { data, error } = await supabase.from("patients")
      .select("id, full_name, mrn, phone, dob, gender, print_language").eq("user_id", u.user.id).maybeSingle();
    if (error) throw error;
    return (data as PortalPatient | null) ?? null;
  },
});
export const useMyPatient = () => useQuery(myPatientQuery);

export const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] ?? "";

export const pkDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
export const pkTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
