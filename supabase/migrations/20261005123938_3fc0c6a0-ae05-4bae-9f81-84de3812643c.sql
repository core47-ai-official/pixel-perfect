CREATE TABLE public.tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  department_id uuid REFERENCES public.departments(id),
  room_class text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX tariffs_hospital_code ON public.tariffs (hospital_id, upper(code));
CREATE INDEX tariffs_category ON public.tariffs (hospital_id, category);
GRANT SELECT ON public.tariffs TO authenticated;
GRANT ALL ON public.tariffs TO service_role;
ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital staff read tariffs" ON public.tariffs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = tariffs.hospital_id AND r.role <> 'patient'));

CREATE TABLE public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric(12,2) NOT NULL DEFAULT 0,
  tariff_codes text[] NOT NULL DEFAULT '{}',
  valid_days integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX packages_hospital_name ON public.packages (hospital_id, lower(name));
GRANT SELECT ON public.packages TO authenticated;
GRANT ALL ON public.packages TO service_role;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital staff read packages" ON public.packages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = packages.hospital_id AND r.role <> 'patient'));