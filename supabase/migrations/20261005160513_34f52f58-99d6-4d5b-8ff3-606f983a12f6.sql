CREATE TABLE public.med_administrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  prescription_id uuid REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  prescription_item_id uuid REFERENCES public.prescription_items(id) ON DELETE SET NULL,
  medicine_name text NOT NULL,
  dose text NOT NULL DEFAULT '',
  route text NOT NULL DEFAULT '',
  scheduled_at timestamptz NOT NULL,
  given_at timestamptz,
  given_by uuid,
  status text NOT NULL DEFAULT 'scheduled',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX med_admin_item_slot ON public.med_administrations(prescription_item_id, scheduled_at);
CREATE INDEX med_admin_adm_idx ON public.med_administrations(admission_id, scheduled_at);
CREATE INDEX med_admin_patient_idx ON public.med_administrations(patient_id);
GRANT SELECT ON public.med_administrations TO authenticated;
GRANT ALL ON public.med_administrations TO service_role;
ALTER TABLE public.med_administrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff read medication administrations" ON public.med_administrations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = med_administrations.hospital_id
          AND r.role IN ('super_admin','admin','dept_head','doctor','nurse','pharmacist','er_officer')));