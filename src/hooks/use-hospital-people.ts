import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Names of everyone in the caller's hospital (readable by super_admin/admin via RLS). */
export function useHospitalPeople() {
  const q = useQuery({
    queryKey: ["hospital-people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name").order("full_name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const people = q.data ?? [];
  return { people, nameOf: (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.full_name ?? "—" : "—") };
}

export function useDateTimeFormat(lang: string) {
  return new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-PK", { dateStyle: "medium", timeStyle: "short" });
}
