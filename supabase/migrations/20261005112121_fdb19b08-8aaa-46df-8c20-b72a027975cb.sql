CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  appointment_id uuid REFERENCES public.appointments(id),
  type text NOT NULL DEFAULT 'opd' CHECK (type IN ('opd','er','ipd')),
  chief_complaint text NOT NULL DEFAULT '',
  history text NOT NULL DEFAULT '',
  examination text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT '',
  template text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX visits_one_per_appointment ON public.visits(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX visits_patient ON public.visits(hospital_id, patient_id, created_at DESC);
CREATE INDEX visits_doctor ON public.visits(doctor_id, status);

CREATE TABLE public.vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  visit_id uuid REFERENCES public.visits(id),
  bp_sys integer, bp_dia integer, pulse integer, temp_c numeric(4,1), spo2 integer,
  weight_kg numeric(5,1), height_cm numeric(5,1), rr integer,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX vitals_patient ON public.vitals(hospital_id, patient_id, recorded_at DESC);

CREATE TABLE public.visit_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX visit_addenda_visit ON public.visit_addenda(visit_id, created_at);

GRANT SELECT ON public.visits, public.vitals, public.visit_addenda TO authenticated;
GRANT ALL ON public.visits, public.vitals, public.visit_addenda TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_addenda ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical staff read visits" ON public.visits FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = visits.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator')));
CREATE POLICY "Patients read own completed visits" ON public.visits FOR SELECT TO authenticated USING (
  status = 'completed' AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = visits.patient_id AND p.user_id = auth.uid()));

CREATE POLICY "Clinical staff read vitals" ON public.vitals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = vitals.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator')));
CREATE POLICY "Patients read own vitals" ON public.vitals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = vitals.patient_id AND p.user_id = auth.uid()));

CREATE POLICY "Clinical staff read addenda" ON public.visit_addenda FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = visit_addenda.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator')));