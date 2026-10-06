CREATE TABLE public.health_report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_account_id uuid NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  date_from date NOT NULL,
  date_to date NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX health_report_shares_appt ON public.health_report_shares(appointment_id);
CREATE INDEX health_report_shares_doctor ON public.health_report_shares(doctor_id, created_at DESC);
GRANT SELECT ON public.health_report_shares TO authenticated;
GRANT ALL ON public.health_report_shares TO service_role;
ALTER TABLE public.health_report_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Patients read own shared reports" ON public.health_report_shares FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "Appointment doctor reads shared report" ON public.health_report_shares FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_id AND d.user_id = auth.uid()));