CREATE TABLE public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  requested_by uuid,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  approved_by uuid,
  decided_at timestamptz,
  decision_note text,
  received_by uuid,
  received_at timestamptz,
  received_batches jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_requests_hosp_idx ON public.purchase_requests(hospital_id, status, created_at DESC);
GRANT SELECT ON public.purchase_requests TO authenticated;
GRANT ALL ON public.purchase_requests TO service_role;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pharmacy and admins read purchase requests" ON public.purchase_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = purchase_requests.hospital_id
          AND r.role IN ('super_admin','admin','pharmacist')));