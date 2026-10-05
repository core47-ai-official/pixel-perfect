CREATE TABLE public.medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  generic_name text NOT NULL,
  brand_name text,
  strength text,
  form text NOT NULL DEFAULT 'tablet',
  route text NOT NULL DEFAULT 'oral',
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  drap_reg_no text,
  is_active boolean NOT NULL DEFAULT true,
  interaction_group text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX medicines_unique ON public.medicines (hospital_id, lower(generic_name), lower(coalesce(brand_name,'')), lower(coalesce(strength,'')), form);
CREATE INDEX medicines_groups ON public.medicines USING gin (interaction_group);

CREATE TABLE public.drug_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  group_a text NOT NULL,
  group_b text NOT NULL,
  severity text NOT NULL DEFAULT 'moderate',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX drug_interactions_pair ON public.drug_interactions (hospital_id, least(group_a, group_b), greatest(group_a, group_b));

GRANT SELECT ON public.medicines, public.drug_interactions TO authenticated;
GRANT ALL ON public.medicines, public.drug_interactions TO service_role;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drug_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read medicines" ON public.medicines FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = medicines.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Hospital staff read drug interactions" ON public.drug_interactions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = drug_interactions.hospital_id AND r.role <> 'patient'));