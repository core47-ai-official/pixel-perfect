ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'outside_doctor';
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_outside boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS clinic text,
  ADD COLUMN IF NOT EXISTS credential_path text;
UPDATE public.doctors SET verified = true, verification_status = 'approved', verified_at = now() WHERE is_outside = false AND verified = false;