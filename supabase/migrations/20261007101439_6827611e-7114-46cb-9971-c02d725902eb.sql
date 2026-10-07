CREATE POLICY "credentials_admin_read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'credentials' AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role IN ('admin','super_admin') AND r.hospital_id::text = (storage.foldername(name))[1]));
CREATE POLICY "credentials_owner_read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'credentials' AND (storage.foldername(name))[2] = auth.uid()::text);