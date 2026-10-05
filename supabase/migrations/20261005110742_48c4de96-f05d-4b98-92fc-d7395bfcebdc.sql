ALTER TABLE public.appointments
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN called_at timestamptz,
  ADD COLUMN completed_at timestamptz;
CREATE INDEX appointments_queue ON public.appointments (hospital_id, doctor_id, status, token_no);