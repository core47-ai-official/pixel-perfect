CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id),
  department_id uuid REFERENCES public.departments(id),
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  token_no integer,
  type text NOT NULL DEFAULT 'new',
  channel text NOT NULL DEFAULT 'reception',
  status text NOT NULL DEFAULT 'booked',
  fee numeric(12,2) NOT NULL DEFAULT 0,
  follow_up_of uuid REFERENCES public.appointments(id),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT appointments_type_chk CHECK (type IN ('new','follow_up','procedure')),
  CONSTRAINT appointments_channel_chk CHECK (channel IN ('reception','portal','phone')),
  CONSTRAINT appointments_status_chk CHECK (status IN ('booked','waiting','in_consultation','done','no_show','cancelled','needs_rebooking'))
);
CREATE UNIQUE INDEX appointments_no_double_booking ON public.appointments (doctor_id, slot_start)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX appointments_hospital_day ON public.appointments (hospital_id, slot_start);
CREATE INDEX appointments_patient ON public.appointments (patient_id);

GRANT SELECT ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read appointments" ON public.appointments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = appointments.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Patients read own appointments" ON public.appointments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients p WHERE p.id = appointments.patient_id AND p.user_id = auth.uid()));