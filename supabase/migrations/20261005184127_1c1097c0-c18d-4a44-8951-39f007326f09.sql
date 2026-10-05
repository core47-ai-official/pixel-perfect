CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  from_facility text NOT NULL, to_facility text NOT NULL,
  reason text NOT NULL, summary text,
  urgency text NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','emergency')),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','rejected','completed')),
  status_note text, status_at timestamptz,
  contact_person text, contact_phone text,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  emergency_case_id uuid REFERENCES public.emergency_cases(id) ON DELETE SET NULL,
  referred_by uuid, referred_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
CREATE INDEX referrals_hospital_idx ON public.referrals (hospital_id, direction, created_at DESC);
CREATE INDEX referrals_patient_idx ON public.referrals (patient_id);
CREATE UNIQUE INDEX referrals_er_case_uniq ON public.referrals (emergency_case_id) WHERE emergency_case_id IS NOT NULL;
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff read referrals" ON public.referrals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = referrals.hospital_id
    AND r.role = ANY (ARRAY['super_admin','admin','dept_head','doctor','nurse','er_officer','receptionist']::app_role[])));
CREATE POLICY "Patients read own referrals" ON public.referrals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = referrals.patient_id AND p.user_id = auth.uid()));