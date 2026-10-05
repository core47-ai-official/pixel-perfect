CREATE TYPE public.leave_status AS ENUM ('pending','approved','rejected');

CREATE TABLE public.doctor_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  type text NOT NULL DEFAULT 'casual',
  reason text NOT NULL DEFAULT '',
  status public.leave_status NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  affected_appointments integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX doctor_leaves_doctor_idx ON public.doctor_leaves (doctor_id, from_date, to_date);

GRANT SELECT ON public.doctor_leaves TO authenticated;
GRANT ALL ON public.doctor_leaves TO service_role;
ALTER TABLE public.doctor_leaves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read hospital doctor leaves" ON public.doctor_leaves FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.hospital_id = doctor_leaves.hospital_id));