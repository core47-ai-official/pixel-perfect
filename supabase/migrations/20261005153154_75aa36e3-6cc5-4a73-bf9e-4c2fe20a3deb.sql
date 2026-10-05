CREATE TABLE public.operation_theatres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'major' CHECK (type IN ('major','minor','cardiac','obstetric')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX operation_theatres_name ON public.operation_theatres (hospital_id, upper(name));

CREATE TABLE public.ot_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  ot_id uuid REFERENCES public.operation_theatres(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  admission_id uuid REFERENCES public.admissions(id),
  surgeon_id uuid NOT NULL REFERENCES public.doctors(id),
  anesthetist_id uuid REFERENCES public.doctors(id),
  team_ids uuid[] NOT NULL DEFAULT '{}',
  procedure text NOT NULL,
  planned_start timestamptz,
  planned_minutes integer NOT NULL DEFAULT 60 CHECK (planned_minutes BETWEEN 5 AND 1440),
  cleaning_minutes integer NOT NULL DEFAULT 30 CHECK (cleaning_minutes BETWEEN 0 AND 240),
  priority text NOT NULL DEFAULT 'elective' CHECK (priority IN ('emergency','elective')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','scheduled','in_progress','completed','cancelled','bumped')),
  bump_reason text, note text,
  requested_by uuid, scheduled_by uuid,
  actual_start timestamptz, actual_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ot_bookings_ot_start ON public.ot_bookings (ot_id, planned_start);
CREATE INDEX ot_bookings_status ON public.ot_bookings (hospital_id, status);
CREATE INDEX ot_bookings_surgeon ON public.ot_bookings (surgeon_id, planned_start);

GRANT SELECT ON public.operation_theatres, public.ot_bookings TO authenticated;
GRANT ALL ON public.operation_theatres, public.ot_bookings TO service_role;
ALTER TABLE public.operation_theatres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read theatres" ON public.operation_theatres FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = operation_theatres.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read OT bookings" ON public.ot_bookings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = ot_bookings.hospital_id AND r.role <> 'patient'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.ot_bookings;