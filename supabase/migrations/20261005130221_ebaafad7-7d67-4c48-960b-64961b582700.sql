CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  visit_id uuid REFERENCES public.visits(id),
  admission_id uuid REFERENCES public.admissions(id),
  invoice_no text NOT NULL,
  payer_type text NOT NULL DEFAULT 'self',
  total numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  paid numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX invoices_hospital_no ON public.invoices (hospital_id, invoice_no);
-- One open bill per patient for OPD (no admission) and one per admission.
CREATE UNIQUE INDEX invoices_one_open_opd ON public.invoices (patient_id) WHERE admission_id IS NULL AND status IN ('open','partly_paid');
CREATE UNIQUE INDEX invoices_one_open_adm ON public.invoices (admission_id) WHERE admission_id IS NOT NULL AND status IN ('open','partly_paid');
CREATE INDEX invoices_patient ON public.invoices (hospital_id, patient_id, created_at DESC);
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing and front-desk staff read invoices" ON public.invoices FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = invoices.hospital_id
    AND r.role IN ('super_admin','admin','cashier','receptionist','er_officer')));
CREATE POLICY "Patients read own invoices" ON public.invoices FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = invoices.patient_id AND p.user_id = auth.uid()));

CREATE TABLE public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES public.tariffs(id),
  description text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
-- The same appointment, order or room-day can never be charged twice.
CREATE UNIQUE INDEX invoice_lines_one_per_source ON public.invoice_lines (hospital_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX invoice_lines_invoice ON public.invoice_lines (invoice_id);
GRANT SELECT ON public.invoice_lines TO authenticated;
GRANT ALL ON public.invoice_lines TO service_role;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing and front-desk staff read invoice lines" ON public.invoice_lines FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = invoice_lines.hospital_id
    AND r.role IN ('super_admin','admin','cashier','receptionist','er_officer')));
CREATE POLICY "Patients read own invoice lines" ON public.invoice_lines FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.invoices i JOIN public.patients p ON p.id = i.patient_id WHERE i.id = invoice_lines.invoice_id AND p.user_id = auth.uid()));