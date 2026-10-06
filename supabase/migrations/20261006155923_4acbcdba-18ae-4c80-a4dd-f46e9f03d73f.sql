CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid REFERENCES public.patients(id),
  visit_id uuid REFERENCES public.visits(id),
  department_id uuid REFERENCES public.departments(id),
  doctor_id uuid REFERENCES public.doctors(id),
  rating smallint NOT NULL,
  comment text,
  category text NOT NULL DEFAULT 'general',
  is_complaint boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  channel text NOT NULL DEFAULT 'portal',
  assigned_to uuid,
  assigned_at timestamptz,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX feedback_one_per_visit ON public.feedback(visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX feedback_hospital_idx ON public.feedback(hospital_id, created_at DESC);
GRANT SELECT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_admin_read" ON public.feedback FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = feedback.hospital_id AND ur.role IN ('super_admin','admin'))
  OR assigned_to = auth.uid());
CREATE POLICY "feedback_own_read" ON public.feedback FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients p WHERE p.id = feedback.patient_id AND p.user_id = auth.uid()));