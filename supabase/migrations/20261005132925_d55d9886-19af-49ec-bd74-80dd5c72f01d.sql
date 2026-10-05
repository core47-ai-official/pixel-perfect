CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  receipt_no text NOT NULL,
  kind text NOT NULL DEFAULT 'payment',
  amount numeric(12,2) NOT NULL,
  payment_mode text NOT NULL DEFAULT 'cash',
  tendered numeric(12,2),
  reason text,
  deposit_id uuid,
  received_by uuid NOT NULL,
  shift_id uuid,
  reverses_id uuid REFERENCES public.payments(id),
  reversed_by_id uuid REFERENCES public.payments(id),
  reversal_requested_by uuid,
  reversal_requested_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX payments_hospital_receipt ON public.payments (hospital_id, receipt_no);
CREATE INDEX payments_invoice ON public.payments (invoice_id);
CREATE INDEX payments_day ON public.payments (hospital_id, created_at);
CREATE UNIQUE INDEX payments_one_reversal ON public.payments (reverses_id) WHERE reverses_id IS NOT NULL;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing staff read payments" ON public.payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = payments.hospital_id
    AND r.role IN ('super_admin','admin','cashier','receptionist')));
CREATE POLICY "Patients read own payments" ON public.payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = payments.patient_id AND p.user_id = auth.uid()));

CREATE TABLE public.deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  admission_id uuid REFERENCES public.admissions(id),
  amount numeric(12,2) NOT NULL,
  receipt_no text NOT NULL,
  applied_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode text NOT NULL DEFAULT 'cash',
  note text NOT NULL DEFAULT '',
  received_by uuid NOT NULL,
  shift_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX deposits_hospital_receipt ON public.deposits (hospital_id, receipt_no);
CREATE INDEX deposits_patient ON public.deposits (patient_id);
GRANT SELECT ON public.deposits TO authenticated;
GRANT ALL ON public.deposits TO service_role;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing staff read deposits" ON public.deposits FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = deposits.hospital_id
    AND r.role IN ('super_admin','admin','cashier','receptionist')));
CREATE POLICY "Patients read own deposits" ON public.deposits FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = deposits.patient_id AND p.user_id = auth.uid()));
ALTER TABLE public.payments ADD CONSTRAINT payments_deposit_fk FOREIGN KEY (deposit_id) REFERENCES public.deposits(id);