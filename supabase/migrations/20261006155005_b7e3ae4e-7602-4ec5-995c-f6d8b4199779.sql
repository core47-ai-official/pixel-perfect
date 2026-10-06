CREATE TABLE public.payer_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'health_card',
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);
GRANT SELECT ON public.payer_programmes TO authenticated;
GRANT ALL ON public.payer_programmes TO service_role;
ALTER TABLE public.payer_programmes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payer_programmes_staff_read" ON public.payer_programmes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = payer_programmes.hospital_id AND ur.role <> 'patient'));

CREATE TABLE public.patient_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  programme_id uuid NOT NULL REFERENCES public.payer_programmes(id),
  card_no text NOT NULL,
  valid_until date,
  limit_amount numeric(12,2) NOT NULL DEFAULT 0,
  used_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (programme_id, card_no)
);
CREATE INDEX patient_entitlements_patient_idx ON public.patient_entitlements(patient_id);
GRANT SELECT ON public.patient_entitlements TO authenticated;
GRANT ALL ON public.patient_entitlements TO service_role;
ALTER TABLE public.patient_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_entitlements_staff_read" ON public.patient_entitlements FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = patient_entitlements.hospital_id AND ur.role <> 'patient'));
CREATE POLICY "patient_entitlements_own_read" ON public.patient_entitlements FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_entitlements.patient_id AND p.user_id = auth.uid()));

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS entitlement_id uuid REFERENCES public.patient_entitlements(id);
CREATE INDEX IF NOT EXISTS invoices_entitlement_idx ON public.invoices(entitlement_id);