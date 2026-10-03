CREATE TABLE public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  user_id uuid NOT NULL,
  impersonated_by uuid,
  document_type text NOT NULL,
  document_id text,
  patient_id uuid,
  paper text NOT NULL,
  languages text[] NOT NULL DEFAULT ARRAY['en'],
  copies integer NOT NULL DEFAULT 1,
  page text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX print_jobs_hospital_idx ON public.print_jobs (hospital_id, created_at DESC);
GRANT SELECT ON public.print_jobs TO authenticated;
GRANT ALL ON public.print_jobs TO service_role;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own print jobs" ON public.print_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Super admin reads hospital print jobs" ON public.print_jobs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = print_jobs.hospital_id AND ur.role = 'super_admin'::app_role));