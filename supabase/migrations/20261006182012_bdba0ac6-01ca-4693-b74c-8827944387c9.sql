ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS doctor_code text;
CREATE UNIQUE INDEX IF NOT EXISTS doctors_code_unique ON public.doctors(hospital_id, doctor_code) WHERE doctor_code IS NOT NULL;
UPDATE public.doctors SET doctor_code = upper(substr(md5(id::text || random()::text), 1, 6)) WHERE doctor_code IS NULL;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS patient_name text, ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER PUBLICATION supabase_realtime ADD TABLE public.connections;