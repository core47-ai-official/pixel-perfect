CREATE TABLE public.admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  bed_id uuid REFERENCES public.beds(id),
  admitting_doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  department_id uuid REFERENCES public.departments(id),
  bed_request_id uuid,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  discharged_at timestamptz,
  status text NOT NULL DEFAULT 'admitted',
  reason text NOT NULL,
  discharge_type text,
  discharge_note text,
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0,
  transfers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX admissions_one_active_per_patient ON public.admissions (patient_id) WHERE status = 'admitted';
CREATE UNIQUE INDEX admissions_one_active_per_bed ON public.admissions (bed_id) WHERE status = 'admitted';
CREATE INDEX admissions_hospital_status ON public.admissions (hospital_id, status);

CREATE TABLE public.bed_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  source text NOT NULL DEFAULT 'opd',
  bed_class text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'routine',
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  doctor_id uuid REFERENCES public.doctors(id),
  note text NOT NULL DEFAULT '',
  bed_id uuid REFERENCES public.beds(id),
  allotted_by uuid,
  allotted_at timestamptz,
  admission_id uuid REFERENCES public.admissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX bed_requests_open ON public.bed_requests (hospital_id, status);
CREATE UNIQUE INDEX bed_requests_one_open_per_patient ON public.bed_requests (patient_id) WHERE status IN ('pending','allotted');

ALTER TABLE public.beds ADD CONSTRAINT beds_current_admission_fk FOREIGN KEY (current_admission_id) REFERENCES public.admissions(id);

GRANT SELECT ON public.admissions, public.bed_requests TO authenticated;
GRANT ALL ON public.admissions, public.bed_requests TO service_role;
ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ward staff read admissions" ON public.admissions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = admissions.hospital_id
    AND r.role IN ('super_admin','admin','dept_head','doctor','nurse','er_officer','ot_coordinator','receptionist','cashier')));
CREATE POLICY "Patients read own admissions" ON public.admissions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = admissions.patient_id AND p.user_id = auth.uid()));
CREATE POLICY "Ward staff read bed requests" ON public.bed_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = bed_requests.hospital_id
    AND r.role IN ('super_admin','admin','dept_head','doctor','nurse','er_officer','receptionist')));

ALTER PUBLICATION supabase_realtime ADD TABLE public.bed_requests;