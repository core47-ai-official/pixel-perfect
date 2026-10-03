import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";

export const DEPT_TYPES = ["clinical", "surgical", "diagnostic", "emergency", "support", "administrative"] as const;
export interface Dept { id: string; name: string; type: string; head_doctor_id: string | null }
export interface Doc {
  id: string; user_id: string; department_id: string | null; specialty: string; gender: string | null;
  languages: string[]; consultation_fee: number; followup_fee: number; pmdc_no: string | null; status: string;
}

/** Departments, doctors and staff names for the current hospital (RLS-scoped reads). */
export function useDepartmentsData() {
  const { context } = useMyContext();
  const hid = context?.hospital?.id;
  const depts = useQuery({
    queryKey: ["departments", hid], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name, type, head_doctor_id").order("name");
      if (error) throw error;
      return data as Dept[];
    },
  });
  const doctors = useQuery({
    queryKey: ["doctors", hid], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("*").order("created_at");
      if (error) throw error;
      return data as unknown as Doc[];
    },
  });
  // Admins can read every profile in the hospital; other staff only see their own name.
  const people = useQuery({
    queryKey: ["hospital-profiles", hid], enabled: !!hid,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name").order("full_name");
      if (error) throw error;
      return data;
    },
  });
  return { depts, doctors, people };
}
