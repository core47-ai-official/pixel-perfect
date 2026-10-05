ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_in_charge boolean NOT NULL DEFAULT false;

CREATE TABLE public.roster_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ward_id uuid REFERENCES public.wards(id) ON DELETE SET NULL,
  date date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('morning','evening','night','on_call')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  note text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, date, shift)
);
CREATE INDEX roster_shifts_hospital_date ON public.roster_shifts (hospital_id, date);
GRANT SELECT ON public.roster_shifts TO authenticated;
GRANT ALL ON public.roster_shifts TO service_role;
ALTER TABLE public.roster_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read own shifts" ON public.roster_shifts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read hospital shifts" ON public.roster_shifts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = roster_shifts.hospital_id AND r.role = ANY (ARRAY['admin','super_admin']::public.app_role[])));
CREATE POLICY "Department heads read department shifts" ON public.roster_shifts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = roster_shifts.hospital_id AND r.role = 'dept_head' AND r.department_id = roster_shifts.department_id));
CREATE POLICY "Ward in-charge reads ward shifts" ON public.roster_shifts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = roster_shifts.hospital_id AND r.role = 'nurse' AND r.is_in_charge AND roster_shifts.ward_id = ANY (r.ward_ids)));
