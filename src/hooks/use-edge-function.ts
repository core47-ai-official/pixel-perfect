import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getImpersonation } from "@/lib/impersonation";

export interface EdgeError {
  code: string;
  message: string;
}


/** Low-level call: invokes an Edge Function and unwraps { ok, data } / { ok:false, error }. */
export async function callEdgeFunction<TOut, TIn = unknown>(name: string, body?: TIn): Promise<TOut> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const imp = getImpersonation();
    if (imp) headers["x-impersonation-session"] = imp.sessionId;
    headers["x-page"] = window.location.pathname;
  }
  const { data, error } = await supabase.functions.invoke(name, { body: body ?? {}, headers });
  if (error) {
    let parsed: EdgeError | null = null;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        parsed = (await ctx.json())?.error ?? null;
      } catch {
        /* not JSON */
      }
    }
    throw parsed ?? { code: "network", message: i18n.t("errors.generic") };
  }
  if (data && data.ok === false) throw data.error as EdgeError;
  return (data?.data ?? data) as TOut;
}

interface Options {
  /** Query keys to invalidate after success. */
  invalidate?: QueryKey[];
  /** Toast shown on success (already translated). */
  successMessage?: string;
  /** Set false to handle errors yourself. */
  toastErrors?: boolean;
}

/** The only way the frontend calls Edge Functions: loading state, error toasts, cache invalidation. */
export function useEdgeFunction<TOut = unknown, TIn = unknown>(name: string, opts: Options = {}) {
  const qc = useQueryClient();
  return useMutation<TOut, EdgeError, TIn | void>({
    mutationKey: ["edge", name],
    mutationFn: (input) => callEdgeFunction<TOut, TIn>(name, (input ?? undefined) as TIn),
    onSuccess: async () => {
      if (opts.successMessage) toast.success(opts.successMessage);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
    },
    onError: (err) => {
      if (opts.toastErrors !== false) toast.error(err?.message || i18n.t("errors.generic"));
    },
  });
}
