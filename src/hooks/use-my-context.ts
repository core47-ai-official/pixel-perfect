import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "./use-edge-function";

export type AppRole =
  | "super_admin" | "admin" | "dept_head" | "doctor" | "nurse" | "er_officer"
  | "ot_coordinator" | "receptionist" | "pharmacist" | "lab_tech" | "cashier" | "patient";

export interface MyContext {
  profile: {
    id: string; hospital_id: string; full_name: string; email: string | null; phone: string | null;
    photo_url: string | null; is_active: boolean; must_change_password: boolean;
    preferences: Record<string, unknown>;
  } | null;
  roles: AppRole[];
  hospital: { id: string; name: string; is_active: boolean } | null;
  department: { id: string; name: string; type: string; head_doctor_id: string | null } | null;
  impersonation: {
    sessionId: string; adminUserId: string; targetUserId: string; reason: string; expiresAt: string;
  } | null;
}

/** Calls get-my-context once per signed-in session; refetches only when the user changes. */
export function useMyContext() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") qc.removeQueries({ queryKey: ["my-context"] });
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setUserId(session?.user.id ?? null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const query = useQuery({
    queryKey: ["my-context", userId],
    queryFn: () => callEdgeFunction<MyContext>("get-my-context"),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const roles = query.data?.roles ?? [];
  return {
    ...query,
    context: query.data ?? null,
    isSignedIn: !!userId,
    hasRole: (...r: AppRole[]) => roles.some((x) => r.includes(x)),
  };
}
