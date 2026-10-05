import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, UserPlus, Users } from "lucide-react";
import { RequireRole } from "@/components/mc/require-role";
import { rolesForPage } from "@/config/navigation";
import { EmptyState } from "@/components/mc/empty-state";
import { Ltr } from "@/components/mc/ltr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "@/hooks/use-my-context";
import { PATIENT_ROLES_EDIT, ageFrom } from "@/lib/patients";

export const Route = createFileRoute("/_authenticated/_app/patients")({
  head: () => ({ meta: [{ title: "Patients — MediCore HMS" }] }),
  component: () => (
    <RequireRole roles={rolesForPage("patients")}>
      <PatientsPage />
    </RequireRole>
  ),
});

function PatientsPage() {
  const { t } = useTranslation();
  const { context, hasRole } = useMyContext();
  const canRegister = PATIENT_ROLES_EDIT.some((r) => hasRole(r));
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(id); }, [q]);

  const list = useQuery({
    queryKey: ["patients", "search", context?.hospital?.id, term],
    enabled: !!context?.hospital?.id,
    queryFn: async () => {
      let query = supabase.from("patients").select("id, mrn, full_name, father_or_husband_name, dob, gender, phone, cnic")
        .is("merged_into", null).order("created_at", { ascending: false }).limit(50);
      if (term) {
        const safe = term.replace(/[%,()]/g, " ");
        const digits = safe.replace(/\D/g, "");
        const ors = [`full_name.ilike.%${safe}%`, `mrn.ilike.%${safe}%`];
        if (digits.length >= 4) ors.push(`cnic.ilike.%${digits.length === 13 ? `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}` : safe}%`, `phone.ilike.%${digits.slice(-7)}%`);
        query = query.or(ors.join(","));
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pat.searchPlaceholder")} maxLength={60} />
        </div>
        {canRegister && <Button asChild><Link to="/patients/new"><UserPlus className="size-4" />{t("pat.registerNew")}</Link></Button>}
      </div>
      {list.isLoading ? <Skeleton className="h-64 w-full" /> : list.isError ? (
        <p className="text-sm text-destructive">{t("pat.loadError")}</p>
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState icon={Users} title={term ? t("pat.noMatch") : t("pat.empty")} description={canRegister ? t("pat.emptyBody") : undefined} />
      ) : (
        <div className="overflow-hidden rounded-staff border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start font-medium">{t("pat.mrnLabel")}</th>
                <th className="p-3 text-start font-medium">{t("pat.fullName")}</th>
                <th className="hidden p-3 text-start font-medium md:table-cell">{t("pat.age")}</th>
                <th className="hidden p-3 text-start font-medium md:table-cell">{t("pat.phone")}</th>
                <th className="hidden p-3 text-start font-medium lg:table-cell">{t("pat.cnic")}</th>
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/40">
                  <td className="p-3"><Link to="/patients/$patientId" params={{ patientId: p.id }} className="font-medium text-primary hover:underline"><Ltr>{p.mrn}</Ltr></Link></td>
                  <td className="p-3"><div className="font-medium">{p.full_name}</div>{p.father_or_husband_name && <div className="text-xs text-muted-foreground">{p.father_or_husband_name}</div>}</td>
                  <td className="hidden p-3 md:table-cell">{ageFrom(p.dob) ?? "—"}{p.gender && ` · ${t(`doc.genders.${p.gender}`)}`}</td>
                  <td className="hidden p-3 md:table-cell">{p.phone ? <Ltr>{p.phone}</Ltr> : "—"}</td>
                  <td className="hidden p-3 lg:table-cell">{p.cnic ? <Ltr>{p.cnic}</Ltr> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
