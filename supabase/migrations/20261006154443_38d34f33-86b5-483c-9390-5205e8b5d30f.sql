ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_social_worker boolean NOT NULL DEFAULT false;

CREATE TABLE public.welfare_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'charity',
  balance numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);
GRANT SELECT ON public.welfare_funds TO authenticated;
GRANT ALL ON public.welfare_funds TO service_role;
ALTER TABLE public.welfare_funds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "welfare_funds_staff_read" ON public.welfare_funds FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = welfare_funds.hospital_id
  AND (ur.role IN ('super_admin','admin','cashier') OR ur.is_social_worker)));

CREATE TABLE public.welfare_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  fund_id uuid NOT NULL REFERENCES public.welfare_funds(id),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  amount numeric(12,2) NOT NULL,
  donor_name text,
  donor_phone text,
  receipt_no text,
  patient_id uuid REFERENCES public.patients(id),
  invoice_id uuid REFERENCES public.invoices(id),
  payment_id uuid REFERENCES public.payments(id),
  requested_by uuid,
  approved_by uuid,
  decided_at timestamptz,
  note text,
  decision_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX welfare_tx_fund_idx ON public.welfare_transactions(fund_id, created_at DESC);
CREATE UNIQUE INDEX welfare_tx_one_pending_per_invoice ON public.welfare_transactions(invoice_id) WHERE status = 'pending';
GRANT SELECT ON public.welfare_transactions TO authenticated;
GRANT ALL ON public.welfare_transactions TO service_role;
ALTER TABLE public.welfare_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "welfare_tx_staff_read" ON public.welfare_transactions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = welfare_transactions.hospital_id
  AND (ur.role IN ('super_admin','admin','cashier') OR ur.is_social_worker)));