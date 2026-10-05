CREATE TABLE public.unpaid_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  note text NOT NULL,
  by_user uuid NOT NULL,
  by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX unpaid_followups_invoice ON public.unpaid_followups (invoice_id, created_at DESC);
GRANT SELECT ON public.unpaid_followups TO authenticated;
GRANT ALL ON public.unpaid_followups TO service_role;
ALTER TABLE public.unpaid_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing staff read follow-ups" ON public.unpaid_followups FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = unpaid_followups.hospital_id AND r.role IN ('super_admin','admin','cashier')));