CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid,
  mrn text NOT NULL,
  cnic text,
  b_form text,
  full_name text NOT NULL,
  father_or_husband_name text,
  dob date,
  gender text,
  phone text,
  email text,
  guardian_name text,
  guardian_phone text,
  province text,
  district text,
  tehsil text,
  address text,
  blood_group text,
  allergies text[] NOT NULL DEFAULT '{}',
  chronic_conditions text[] NOT NULL DEFAULT '{}',
  pregnancy_status text,
  print_language text,
  is_unknown boolean NOT NULL DEFAULT false,
  merged_into uuid REFERENCES public.patients(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (hospital_id, mrn)
);
CREATE INDEX patients_cnic_idx ON public.patients (hospital_id, cnic);
CREATE INDEX patients_phone_idx ON public.patients (hospital_id, phone);
CREATE INDEX patients_name_dob_idx ON public.patients (hospital_id, lower(full_name), dob);

GRANT SELECT ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read hospital patients" ON public.patients FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = patients.hospital_id AND ur.role <> 'patient'::app_role));
CREATE POLICY "Patients read own record" ON public.patients FOR SELECT TO authenticated
USING (user_id = auth.uid());