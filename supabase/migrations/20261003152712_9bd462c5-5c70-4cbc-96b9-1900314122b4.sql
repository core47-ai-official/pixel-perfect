CREATE TABLE public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX ON public.impersonation_sessions(admin_user_id) WHERE ended_at IS NULL;
GRANT SELECT ON public.impersonation_sessions TO authenticated;
GRANT ALL ON public.impersonation_sessions TO service_role;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read own impersonation sessions" ON public.impersonation_sessions
  FOR SELECT TO authenticated USING (admin_user_id = auth.uid());