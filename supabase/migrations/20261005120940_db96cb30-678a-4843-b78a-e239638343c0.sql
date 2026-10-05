CREATE TABLE public.emergency_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  arrived_at timestamptz NOT NULL DEFAULT now(),
  complaint text NOT NULL DEFAULT '',
  arrival_mode text NOT NULL DEFAULT 'walk_in',
  triage_color text,
  triaged_at timestamptz,
  triaged_by uuid,
  seen_by uuid,
  seen_by_name text,
  seen_at timestamptz,
  bay_bed_id uuid REFERENCES public.beds(id),
  mlc boolean NOT NULL DEFAULT false,
  mlc_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  disposition text,
  disposition_at timestamptz,
  disposition_note text,
  bed_request_id uuid REFERENCES public.bed_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX emergency_cases_open ON public.emergency_cases (hospital_id, disposition, arrived_at);
CREATE UNIQUE INDEX emergency_cases_one_open_per_patient ON public.emergency_cases (patient_id) WHERE disposition IS NULL;
CREATE UNIQUE INDEX emergency_cases_one_open_per_bay ON public.emergency_cases (bay_bed_id) WHERE disposition IS NULL AND bay_bed_id IS NOT NULL;

GRANT SELECT ON public.emergency_cases TO authenticated;
GRANT ALL ON public.emergency_cases TO service_role;
ALTER TABLE public.emergency_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ER and clinical staff read emergency cases" ON public.emergency_cases FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = emergency_cases.hospital_id
    AND r.role IN ('super_admin','admin','dept_head','doctor','nurse','er_officer','receptionist')));

ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_cases;