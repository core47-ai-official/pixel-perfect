CREATE TABLE public.lab_result_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  parameter text NOT NULL,
  value text NOT NULL,
  unit text,
  reference_range text,
  flag text NOT NULL DEFAULT 'normal',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX lab_result_values_order ON public.lab_result_values (order_id, sort);
GRANT SELECT ON public.lab_result_values TO authenticated;
GRANT ALL ON public.lab_result_values TO service_role;
ALTER TABLE public.lab_result_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical, lab and billing staff read result values" ON public.lab_result_values FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = lab_result_values.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator','lab_tech','cashier','receptionist','admin','super_admin')));
CREATE POLICY "Patients read own verified result values" ON public.lab_result_values FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.orders o JOIN public.patients p ON p.id = o.patient_id
          WHERE o.id = lab_result_values.order_id AND o.status = 'verified' AND p.user_id = auth.uid()));

ALTER TABLE public.lab_tests ADD COLUMN parameters jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN resulted_by uuid, ADD COLUMN verified_by uuid, ADD COLUMN has_critical boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_roles ADD COLUMN can_verify_lab boolean NOT NULL DEFAULT false;