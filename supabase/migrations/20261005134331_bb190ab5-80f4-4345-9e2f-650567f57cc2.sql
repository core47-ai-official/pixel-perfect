CREATE TABLE public.installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  approval_id uuid REFERENCES public.approvals(id),
  total numeric(12,2) NOT NULL,
  paid_at_start numeric(12,2) NOT NULL DEFAULT 0,
  schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  approved_by uuid,
  approved_at timestamptz,
  last_reminded_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX installment_plans_one_active ON public.installment_plans (invoice_id) WHERE status = 'active';
CREATE INDEX installment_plans_status ON public.installment_plans (hospital_id, status);
GRANT SELECT ON public.installment_plans TO authenticated;
GRANT ALL ON public.installment_plans TO service_role;
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing staff read installment plans" ON public.installment_plans FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = installment_plans.hospital_id
    AND r.role IN ('super_admin','admin','cashier','receptionist','nurse','doctor','dept_head')));
CREATE POLICY "Patients read own installment plans" ON public.installment_plans FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.patients p WHERE p.id = installment_plans.patient_id AND p.user_id = auth.uid()));