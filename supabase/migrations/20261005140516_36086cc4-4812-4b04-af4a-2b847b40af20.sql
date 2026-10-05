CREATE TABLE public.cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  cashier_id uuid NOT NULL,
  cashier_name text NOT NULL DEFAULT '',
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closed_at timestamptz,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX cashier_shifts_one_open ON public.cashier_shifts (cashier_id) WHERE status = 'open';
CREATE INDEX cashier_shifts_hospital ON public.cashier_shifts (hospital_id, opened_at DESC);
GRANT SELECT ON public.cashier_shifts TO authenticated;
GRANT ALL ON public.cashier_shifts TO service_role;
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cashiers read own shifts" ON public.cashier_shifts FOR SELECT TO authenticated USING (cashier_id = auth.uid());
CREATE POLICY "Admins read all shifts" ON public.cashier_shifts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = cashier_shifts.hospital_id AND r.role IN ('super_admin','admin')));
ALTER TABLE public.payments ADD CONSTRAINT payments_shift_fk FOREIGN KEY (shift_id) REFERENCES public.cashier_shifts(id);
ALTER TABLE public.deposits ADD CONSTRAINT deposits_shift_fk FOREIGN KEY (shift_id) REFERENCES public.cashier_shifts(id);
CREATE INDEX payments_shift ON public.payments (shift_id);
CREATE INDEX deposits_shift ON public.deposits (shift_id);