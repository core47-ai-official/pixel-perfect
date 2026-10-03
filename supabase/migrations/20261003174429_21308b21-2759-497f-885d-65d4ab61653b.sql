CREATE TABLE public.doctor_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  weekday smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 15,
  max_patients integer,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX doctor_schedules_doctor_idx ON public.doctor_schedules (doctor_id, weekday);

GRANT SELECT ON public.doctor_schedules TO authenticated;
GRANT ALL ON public.doctor_schedules TO service_role;
ALTER TABLE public.doctor_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read hospital doctor schedules" ON public.doctor_schedules FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = doctor_schedules.hospital_id));

ALTER TABLE public.doctors REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctors;