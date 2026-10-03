ALTER TABLE public.impersonation_sessions RENAME COLUMN admin_user_id TO super_admin_id;
ALTER TABLE public.impersonation_sessions ADD COLUMN pages_visited jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER POLICY "Admins read own impersonation sessions" ON public.impersonation_sessions RENAME TO "Super admins read own impersonation sessions";