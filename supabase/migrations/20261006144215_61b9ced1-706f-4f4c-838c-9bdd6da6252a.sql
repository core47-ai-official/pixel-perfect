ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key text, ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_uniq ON public.notifications (dedupe_key);
CREATE INDEX IF NOT EXISTS notifications_due_idx ON public.notifications (scheduled_at) WHERE sent_at IS NULL;

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  disabled_types text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
GRANT SELECT ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notification preferences" ON public.notification_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());