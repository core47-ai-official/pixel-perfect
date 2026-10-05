DROP POLICY "Hospital staff read appointments" ON public.appointments;

-- Front-desk / clinical support roles see the whole hospital's appointments.
CREATE POLICY "Hospital staff read appointments" ON public.appointments
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r
          WHERE r.user_id = auth.uid() AND r.hospital_id = appointments.hospital_id
            AND r.role NOT IN ('patient', 'doctor', 'dept_head'))
);

-- Doctors see only appointments with themselves.
CREATE POLICY "Doctors read own appointments" ON public.appointments
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.doctors d
          WHERE d.id = appointments.doctor_id AND d.user_id = auth.uid())
);

-- Department heads see their department's appointments.
CREATE POLICY "Department heads read department appointments" ON public.appointments
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r
          WHERE r.user_id = auth.uid() AND r.hospital_id = appointments.hospital_id
            AND r.role = 'dept_head' AND r.department_id = appointments.department_id)
);