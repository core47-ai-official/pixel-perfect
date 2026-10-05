CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  type text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  payment_id uuid REFERENCES public.payments(id),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  percent numeric(5,2),
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid NOT NULL,
  requested_by_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX approvals_status ON public.approvals (hospital_id, status, created_at);
CREATE INDEX approvals_invoice ON public.approvals (invoice_id);
CREATE UNIQUE INDEX approvals_one_pending_per_bill_type ON public.approvals (invoice_id, type) WHERE status = 'pending' AND type IN ('discount','waiver','installment');
GRANT SELECT ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read approvals" ON public.approvals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = approvals.hospital_id AND r.role IN ('super_admin','admin')));
CREATE POLICY "Requesters read own approvals" ON public.approvals FOR SELECT TO authenticated USING (requested_by = auth.uid());
CREATE POLICY "Billing staff read approvals" ON public.approvals FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = approvals.hospital_id AND r.role IN ('cashier','receptionist')));
ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;