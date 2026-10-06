ALTER TABLE public.medication_schedules
  ADD COLUMN source text NOT NULL DEFAULT 'patient',
  ADD COLUMN prescription_id uuid REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  ADD COLUMN frequency text,
  ADD COLUMN duration_days int,
  ADD COLUMN instructions text;
ALTER TABLE public.medication_schedules DROP CONSTRAINT IF EXISTS medication_schedules_rx_item_id_fkey;
ALTER TABLE public.medication_schedules ADD CONSTRAINT medication_schedules_rx_item_id_fkey FOREIGN KEY (rx_item_id) REFERENCES public.prescription_items(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX medication_schedules_rx_name ON public.medication_schedules(prescription_id, lower(name)) WHERE prescription_id IS NOT NULL;
ALTER TABLE public.dose_events ADD COLUMN snoozed_until timestamptz, ADD COLUMN reminded_at timestamptz;
CREATE INDEX dose_events_pending ON public.dose_events(due_at) WHERE status IS NULL;