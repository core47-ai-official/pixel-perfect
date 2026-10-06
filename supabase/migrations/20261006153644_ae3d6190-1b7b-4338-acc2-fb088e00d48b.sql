CREATE TABLE public.blood_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  unit_no text NOT NULL,
  blood_group text NOT NULL,
  component text NOT NULL DEFAULT 'prbc',
  volume_ml integer,
  collected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'available',
  donor_id uuid REFERENCES public.patients(id),
  donor_name text,
  reserved_for_request_id uuid,
  issued_to_patient_id uuid REFERENCES public.patients(id),
  issued_request_id uuid,
  issued_at timestamptz,
  issued_by uuid,
  discard_reason text,
  discarded_at timestamptz,
  discarded_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blood_units_group_chk CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  CONSTRAINT blood_units_component_chk CHECK (component IN ('whole','prbc','ffp','platelets')),
  CONSTRAINT blood_units_status_chk CHECK (status IN ('available','reserved','issued','discarded'))
);
CREATE UNIQUE INDEX blood_units_hospital_unit_no ON public.blood_units(hospital_id, unit_no);
CREATE INDEX blood_units_board ON public.blood_units(hospital_id, status, blood_group, component);

CREATE TABLE public.blood_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  requested_by uuid,
  emergency_case_id uuid REFERENCES public.emergency_cases(id),
  admission_id uuid REFERENCES public.admissions(id),
  blood_group text NOT NULL,
  component text NOT NULL DEFAULT 'prbc',
  units integer NOT NULL DEFAULT 1,
  urgency text NOT NULL DEFAULT 'routine',
  reason text,
  status text NOT NULL DEFAULT 'requested',
  crossmatch_result text,
  crossmatch_note text,
  crossmatched_by uuid,
  crossmatched_at timestamptz,
  reserved_unit_ids uuid[] NOT NULL DEFAULT '{}',
  units_issued integer NOT NULL DEFAULT 0,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blood_requests_group_chk CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  CONSTRAINT blood_requests_component_chk CHECK (component IN ('whole','prbc','ffp','platelets')),
  CONSTRAINT blood_requests_units_chk CHECK (units BETWEEN 1 AND 20),
  CONSTRAINT blood_requests_urgency_chk CHECK (urgency IN ('routine','urgent','emergency')),
  CONSTRAINT blood_requests_status_chk CHECK (status IN ('requested','crossmatched','incompatible','partly_issued','issued','cancelled')),
  CONSTRAINT blood_requests_xm_chk CHECK (crossmatch_result IS NULL OR crossmatch_result IN ('compatible','incompatible'))
);
CREATE INDEX blood_requests_queue ON public.blood_requests(hospital_id, status, created_at);
CREATE INDEX blood_requests_patient ON public.blood_requests(patient_id);

GRANT SELECT ON public.blood_units TO authenticated;
GRANT ALL ON public.blood_units TO service_role;
GRANT SELECT ON public.blood_requests TO authenticated;
GRANT ALL ON public.blood_requests TO service_role;

ALTER TABLE public.blood_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Blood staff read hospital blood units" ON public.blood_units FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = blood_units.hospital_id
          AND r.role IN ('super_admin','admin','lab_tech','doctor','er_officer','nurse','dept_head','ot_coordinator')));
CREATE POLICY "Blood staff read hospital blood requests" ON public.blood_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = blood_requests.hospital_id
          AND r.role IN ('super_admin','admin','lab_tech','doctor','er_officer','nurse','dept_head','ot_coordinator')));

ALTER PUBLICATION supabase_realtime ADD TABLE public.blood_units;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blood_requests;

INSERT INTO public.tariffs (hospital_id, code, name, category, price, is_active)
SELECT h.id, v.code, v.name, 'other', v.price, true
FROM public.hospitals h
CROSS JOIN (VALUES
  ('BB-WHOLE', 'Whole blood (per unit)', 4500),
  ('BB-PRBC', 'Packed red cells (per unit)', 4000),
  ('BB-FFP', 'Fresh frozen plasma (per unit)', 2500),
  ('BB-PLATELETS', 'Platelets (per unit)', 3500)
) AS v(code, name, price)
WHERE NOT EXISTS (SELECT 1 FROM public.tariffs t WHERE t.hospital_id = h.id AND t.code = v.code);