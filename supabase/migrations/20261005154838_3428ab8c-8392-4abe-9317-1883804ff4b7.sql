CREATE TABLE public.ot_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.ot_bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pre_op','who_sign_in','who_time_out','who_sign_out')),
  items jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_by uuid, completed_at timestamptz, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind)
);
CREATE TABLE public.operation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.ot_bookings(id) ON DELETE CASCADE,
  anesthesia_note text, operation_note text, findings text, complications text,
  written_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ot_consumables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.ot_bookings(id) ON DELETE CASCADE,
  medicine_or_item text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  logged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ot_consumables_booking ON public.ot_consumables (booking_id);

GRANT SELECT ON public.ot_checklists, public.operation_notes, public.ot_consumables TO authenticated;
GRANT ALL ON public.ot_checklists, public.operation_notes, public.ot_consumables TO service_role;
ALTER TABLE public.ot_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read OT checklists" ON public.ot_checklists FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = ot_checklists.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read operation notes" ON public.operation_notes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = operation_notes.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read OT consumables" ON public.ot_consumables FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = ot_consumables.hospital_id AND r.role <> 'patient'));