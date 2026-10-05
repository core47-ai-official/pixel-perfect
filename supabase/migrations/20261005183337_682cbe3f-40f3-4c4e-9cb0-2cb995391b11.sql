CREATE TABLE public.discharge_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL UNIQUE REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  diagnosis text, procedures text, course text, condition_at_discharge text,
  medicines jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up_date date, advice_en text, advice_ur text,
  written_by uuid, finalized_at timestamptz, finalized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
GRANT SELECT ON public.discharge_summaries TO authenticated;
GRANT ALL ON public.discharge_summaries TO service_role;
ALTER TABLE public.discharge_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ward staff read discharge summaries" ON public.discharge_summaries FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = discharge_summaries.hospital_id
    AND r.role = ANY (ARRAY['super_admin','admin','dept_head','doctor','nurse','er_officer','ot_coordinator','receptionist','cashier','pharmacist']::app_role[])));
CREATE POLICY "Patients read own finalized discharge summaries" ON public.discharge_summaries FOR SELECT TO authenticated USING (
  finalized_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = discharge_summaries.patient_id AND p.user_id = auth.uid()));