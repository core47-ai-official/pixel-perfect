ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS reorder_level integer NOT NULL DEFAULT 0;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL, phone text, address text, ntn text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name ON public.suppliers (hospital_id, lower(name));

CREATE TABLE public.stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  batch_no text NOT NULL,
  expiry_date date NOT NULL,
  qty_received integer NOT NULL CHECK (qty_received > 0),
  qty_on_hand integer NOT NULL CHECK (qty_on_hand >= 0),
  cost_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  supplier_id uuid REFERENCES public.suppliers(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_batches_unique ON public.stock_batches (medicine_id, upper(batch_no));
CREATE INDEX stock_batches_expiry ON public.stock_batches (hospital_id, expiry_date) WHERE qty_on_hand > 0;

CREATE TABLE public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.stock_batches(id) ON DELETE CASCADE,
  qty_change integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('damaged','expired','count')),
  note text, adjusted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_batch ON public.stock_adjustments (batch_id);

GRANT SELECT ON public.suppliers, public.stock_batches, public.stock_adjustments TO authenticated;
GRANT ALL ON public.suppliers, public.stock_batches, public.stock_adjustments TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = suppliers.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read stock batches" ON public.stock_batches FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = stock_batches.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read stock adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = stock_adjustments.hospital_id AND r.role <> 'patient'));