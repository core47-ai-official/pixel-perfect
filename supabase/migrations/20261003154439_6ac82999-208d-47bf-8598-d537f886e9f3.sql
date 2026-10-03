CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  raised_by uuid NOT NULL,
  page text,
  description text NOT NULL,
  screenshot_url text,
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX support_tickets_hospital_idx ON public.support_tickets (hospital_id, created_at DESC);
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin reads hospital tickets" ON public.support_tickets FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = support_tickets.hospital_id AND ur.role = 'super_admin'));
CREATE POLICY "Staff read own tickets" ON public.support_tickets FOR SELECT TO authenticated
USING (raised_by = auth.uid());

-- Storage: files live at tickets/<hospital_id>/<user_id>/<file>
CREATE POLICY "Staff upload own ticket screenshots" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tickets'
  AND (storage.foldername(name))[2] = auth.uid()::text
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id::text = (storage.foldername(name))[1])
);
CREATE POLICY "Staff read own ticket screenshots" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'tickets' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "Super admin reads hospital ticket screenshots" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tickets'
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin' AND ur.hospital_id::text = (storage.foldername(name))[1])
);