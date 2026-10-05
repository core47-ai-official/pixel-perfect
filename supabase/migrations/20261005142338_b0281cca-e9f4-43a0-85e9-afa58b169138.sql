CREATE TABLE public.offline_sync_items (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  result jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offline_sync_items_user_idx ON public.offline_sync_items (user_id, created_at DESC);
GRANT SELECT ON public.offline_sync_items TO authenticated;
GRANT ALL ON public.offline_sync_items TO service_role;
ALTER TABLE public.offline_sync_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own offline sync items" ON public.offline_sync_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());