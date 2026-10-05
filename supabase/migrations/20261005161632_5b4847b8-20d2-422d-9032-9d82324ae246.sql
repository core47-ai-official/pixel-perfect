ALTER TABLE public.orders
  ADD COLUMN sample_barcode text,
  ADD COLUMN collected_by uuid,
  ADD COLUMN collected_at timestamptz,
  ADD COLUMN rejected_reason text,
  ADD COLUMN rejected_by uuid,
  ADD COLUMN rejected_at timestamptz;
CREATE UNIQUE INDEX orders_sample_barcode_unique ON public.orders (hospital_id, sample_barcode) WHERE sample_barcode IS NOT NULL;
CREATE INDEX orders_worklist ON public.orders (hospital_id, status, created_at);
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;