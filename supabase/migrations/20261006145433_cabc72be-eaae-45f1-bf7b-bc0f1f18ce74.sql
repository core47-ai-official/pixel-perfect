CREATE TABLE public.patient_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  linked_at timestamptz,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patient_accounts_patient_uidx ON public.patient_accounts(patient_id) WHERE patient_id IS NOT NULL;
GRANT SELECT ON public.patient_accounts TO authenticated;
GRANT ALL ON public.patient_accounts TO service_role;
ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Patients read own account" ON public.patient_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.patient_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  issued_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_link_codes_patient_idx ON public.patient_link_codes(patient_id, expires_at);
GRANT ALL ON public.patient_link_codes TO service_role;
ALTER TABLE public.patient_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read link codes" ON public.patient_link_codes FOR SELECT TO authenticated USING (false);