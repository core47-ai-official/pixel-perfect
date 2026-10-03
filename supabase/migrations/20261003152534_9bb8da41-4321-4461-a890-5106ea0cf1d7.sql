CREATE TYPE public.app_role AS ENUM ('super_admin','admin','dept_head','doctor','nurse','er_officer','ot_coordinator','receptionist','pharmacist','lab_tech','cashier','patient');

CREATE TABLE public.hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  head_doctor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  phone text,
  photo_url text,
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, hospital_id, role)
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid,
  impersonated_by uuid,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid,
  page text,
  function_name text,
  message text NOT NULL,
  stack text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  key text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  next_value bigint NOT NULL DEFAULT 1,
  reset_rule text NOT NULL DEFAULT 'never',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (hospital_id, key)
);

CREATE INDEX ON public.departments(hospital_id);
CREATE INDEX ON public.profiles(hospital_id);
CREATE INDEX ON public.user_roles(user_id);
CREATE INDEX ON public.audit_logs(hospital_id, created_at DESC);
CREATE INDEX ON public.error_logs(hospital_id, created_at DESC);

GRANT SELECT ON public.hospitals, public.departments, public.profiles, public.user_roles, public.audit_logs, public.error_logs TO authenticated;
GRANT ALL ON public.hospitals, public.departments, public.profiles, public.user_roles, public.audit_logs, public.error_logs, public.counters TO service_role;

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins read hospital profiles" ON public.profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
    AND ur.hospital_id = profiles.hospital_id AND ur.role IN ('super_admin','admin')));

CREATE POLICY "Super admin reads audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
    AND ur.hospital_id = audit_logs.hospital_id AND ur.role = 'super_admin'));

CREATE POLICY "Super admin reads error logs" ON public.error_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
    AND ur.hospital_id = error_logs.hospital_id AND ur.role = 'super_admin'));

CREATE POLICY "Members read own hospital" ON public.hospitals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = hospitals.id));

CREATE POLICY "Members read hospital departments" ON public.departments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = departments.hospital_id));