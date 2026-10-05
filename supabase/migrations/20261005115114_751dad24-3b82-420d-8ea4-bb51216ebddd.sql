ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS ward_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE public.handover_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  ward_id uuid NOT NULL REFERENCES public.wards(id),
  shift_date date NOT NULL,
  shift text NOT NULL,
  note text NOT NULL,
  written_by uuid NOT NULL,
  written_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX handover_notes_ward ON public.handover_notes (ward_id, shift_date DESC, shift);

GRANT SELECT ON public.handover_notes TO authenticated;
GRANT ALL ON public.handover_notes TO service_role;
ALTER TABLE public.handover_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinical staff read handover notes" ON public.handover_notes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = handover_notes.hospital_id
    AND r.role IN ('super_admin','admin','dept_head','doctor','nurse','er_officer')));