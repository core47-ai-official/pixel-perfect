CREATE TABLE public.dispensations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.prescription_items(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.stock_batches(id),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  qty integer NOT NULL,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  dispensed_by uuid,
  substituted_medicine_id uuid REFERENCES public.medicines(id),
  substitution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispensations_rx_idx ON public.dispensations(prescription_id);
CREATE INDEX dispensations_item_idx ON public.dispensations(item_id);
GRANT SELECT ON public.dispensations TO authenticated;
GRANT ALL ON public.dispensations TO service_role;
ALTER TABLE public.dispensations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pharmacy and clinical staff read dispensations" ON public.dispensations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = dispensations.hospital_id
          AND r.role IN ('super_admin','admin','pharmacist','doctor','dept_head','nurse','cashier')));
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;