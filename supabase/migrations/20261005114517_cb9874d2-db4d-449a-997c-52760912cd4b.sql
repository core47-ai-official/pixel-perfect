CREATE TABLE public.wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  gender text NOT NULL DEFAULT 'any',
  floor text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX wards_name ON public.wards (hospital_id, lower(name));

CREATE TABLE public.beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  ward_id uuid NOT NULL REFERENCES public.wards(id),
  label text NOT NULL,
  bed_class text NOT NULL DEFAULT 'general',
  daily_rate numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'free',
  current_admission_id uuid,
  has_oxygen boolean NOT NULL DEFAULT false,
  has_ventilator boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX beds_label ON public.beds (ward_id, upper(label));
CREATE INDEX beds_status ON public.beds (hospital_id, status);

GRANT SELECT ON public.wards, public.beds TO authenticated;
GRANT ALL ON public.wards, public.beds TO service_role;
ALTER TABLE public.wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read wards" ON public.wards FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = wards.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read beds" ON public.beds FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = beds.hospital_id AND r.role <> 'patient'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.beds;