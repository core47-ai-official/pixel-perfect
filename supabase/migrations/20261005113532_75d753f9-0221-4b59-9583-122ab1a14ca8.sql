CREATE TABLE public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  status text NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  warnings jsonb NOT NULL DEFAULT '[]',
  warnings_acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX prescriptions_visit ON public.prescriptions (visit_id);
CREATE INDEX prescriptions_patient ON public.prescriptions (patient_id);

CREATE TABLE public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  medicine_name text NOT NULL,
  dose text NOT NULL DEFAULT '',
  frequency text NOT NULL DEFAULT '',
  route text NOT NULL DEFAULT 'oral',
  duration_days integer,
  instructions_en text NOT NULL DEFAULT '',
  instructions_ur text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX prescription_items_rx ON public.prescription_items (prescription_id);

GRANT SELECT ON public.prescriptions, public.prescription_items TO authenticated;
GRANT ALL ON public.prescriptions, public.prescription_items TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinical and pharmacy staff read prescriptions" ON public.prescriptions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = prescriptions.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator','pharmacist')));
CREATE POLICY "Patients read own prescriptions" ON public.prescriptions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = prescriptions.patient_id AND p.user_id = auth.uid()));
CREATE POLICY "Clinical and pharmacy staff read prescription items" ON public.prescription_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = prescription_items.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator','pharmacist')));
CREATE POLICY "Patients read own prescription items" ON public.prescription_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.prescriptions x JOIN public.patients p ON p.id = x.patient_id
          WHERE x.id = prescription_items.prescription_id AND p.user_id = auth.uid()));