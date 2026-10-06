CREATE TABLE public.tracker_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL UNIQUE REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  height_cm numeric(5,1), weight_kg numeric(5,1), blood_group text,
  emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text NOT NULL DEFAULT 'none',
  onboarding_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tracker_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  name text NOT NULL, status text NOT NULL DEFAULT 'active', onset_date date, notes text,
  source text NOT NULL DEFAULT 'patient',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.symptom_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  symptom text NOT NULL, severity smallint NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  triggers text[] NOT NULL DEFAULT '{}', related text, notes text, attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  type text NOT NULL, value_1 numeric(10,2) NOT NULL, value_2 numeric(10,2), unit text,
  context text, measured_at timestamptz NOT NULL DEFAULT now(), notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.medication_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  rx_item_id uuid REFERENCES public.prescription_items(id),
  name text NOT NULL, dose text, times text[] NOT NULL DEFAULT '{}',
  start_date date NOT NULL DEFAULT current_date, end_date date, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.dose_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  schedule_id uuid NOT NULL REFERENCES public.medication_schedules(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL, status text, logged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, due_at)
);
CREATE TABLE public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  permissions jsonb NOT NULL DEFAULT '{"profile":false,"conditions":false,"medicines":false,"symptoms":false,"measurements":false,"reports":false}'::jsonb,
  status text NOT NULL DEFAULT 'requested', revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connections_one_live ON public.connections(patient_account_id, doctor_id) WHERE status IN ('requested','active');
CREATE INDEX symptom_logs_acct ON public.symptom_logs(patient_account_id, started_at DESC);
CREATE INDEX measurements_acct ON public.measurements(patient_account_id, type, measured_at DESC);
CREATE INDEX dose_events_acct ON public.dose_events(patient_account_id, due_at);
CREATE INDEX tracker_conditions_acct ON public.tracker_conditions(patient_account_id);
CREATE INDEX medication_schedules_acct ON public.medication_schedules(patient_account_id);

GRANT SELECT ON public.tracker_profiles, public.tracker_conditions, public.symptom_logs, public.measurements,
  public.medication_schedules, public.dose_events, public.connections TO authenticated;
GRANT ALL ON public.tracker_profiles, public.tracker_conditions, public.symptom_logs, public.measurements,
  public.medication_schedules, public.dose_events, public.connections TO service_role;

ALTER TABLE public.tracker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dose_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Patient: own rows only (via their patient account)
CREATE POLICY "tp_own" ON public.tracker_profiles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = tracker_profiles.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "tc_own" ON public.tracker_conditions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = tracker_conditions.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "sl_own" ON public.symptom_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = symptom_logs.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "ms_own" ON public.measurements FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = measurements.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "mds_own" ON public.medication_schedules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = medication_schedules.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "de_own" ON public.dose_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = dose_events.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "cn_own" ON public.connections FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = connections.patient_account_id AND pa.user_id = auth.uid()));

-- Doctor: their own connection rows; tracker rows only with an active connection and the matching permission
CREATE POLICY "cn_doctor" ON public.connections FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = connections.doctor_id AND d.user_id = auth.uid()));
CREATE POLICY "tp_doctor" ON public.tracker_profiles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = tracker_profiles.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'profile' = 'true'));
CREATE POLICY "tc_doctor" ON public.tracker_conditions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = tracker_conditions.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'conditions' = 'true'));
CREATE POLICY "sl_doctor" ON public.symptom_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = symptom_logs.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'symptoms' = 'true'));
CREATE POLICY "ms_doctor" ON public.measurements FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = measurements.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'measurements' = 'true'));
CREATE POLICY "mds_doctor" ON public.medication_schedules FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = medication_schedules.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'medicines' = 'true'));
CREATE POLICY "de_doctor" ON public.dose_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = dose_events.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'medicines' = 'true'));