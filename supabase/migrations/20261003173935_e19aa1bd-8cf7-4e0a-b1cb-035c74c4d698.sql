CREATE TYPE public.doctor_status AS ENUM ('available','in_opd','in_surgery','on_round','on_leave','off_duty');

CREATE TABLE public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  specialty text NOT NULL DEFAULT '',
  gender text,
  languages text[] NOT NULL DEFAULT ARRAY['en']::text[],
  consultation_fee numeric(12,2) NOT NULL DEFAULT 0,
  followup_fee numeric(12,2) NOT NULL DEFAULT 0,
  pmdc_no text,
  status public.doctor_status NOT NULL DEFAULT 'off_duty',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (hospital_id, user_id)
);

GRANT SELECT ON public.doctors TO authenticated;
GRANT ALL ON public.doctors TO service_role;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read hospital doctors" ON public.doctors FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = doctors.hospital_id));

CREATE UNIQUE INDEX IF NOT EXISTS departments_hospital_name_uq ON public.departments (hospital_id, lower(name));