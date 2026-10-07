CREATE TABLE public.demo_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_rows_hospital_table_idx ON public.demo_rows (hospital_id, table_name);
GRANT ALL ON public.demo_rows TO service_role;
GRANT SELECT ON public.demo_rows TO authenticated;
ALTER TABLE public.demo_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read their hospital demo rows" ON public.demo_rows FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = demo_rows.hospital_id AND ur.role = 'super_admin'));