ALTER TABLE public.symptom_logs ADD COLUMN deleted_at timestamptz;
DROP POLICY "sl_own" ON public.symptom_logs;
DROP POLICY "sl_doctor" ON public.symptom_logs;
CREATE POLICY "sl_own" ON public.symptom_logs FOR SELECT TO authenticated USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id = symptom_logs.patient_account_id AND pa.user_id = auth.uid()));
CREATE POLICY "sl_doctor" ON public.symptom_logs FOR SELECT TO authenticated USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.connections c JOIN public.doctors d ON d.id = c.doctor_id WHERE c.patient_account_id = symptom_logs.patient_account_id AND d.user_id = auth.uid() AND c.status = 'active' AND c.permissions->>'symptoms' = 'true'));
CREATE POLICY "tracker_files_owner_read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'tracker' AND EXISTS (SELECT 1 FROM public.patient_accounts pa WHERE pa.id::text = (storage.foldername(name))[1] AND pa.user_id = auth.uid()));