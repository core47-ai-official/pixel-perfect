CREATE TABLE public.lab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'lab',
  sample_type text,
  price numeric(12,2) NOT NULL DEFAULT 0,
  reference_range text,
  turnaround_hours integer NOT NULL DEFAULT 24,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX lab_tests_code ON public.lab_tests (hospital_id, upper(code));

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  visit_id uuid REFERENCES public.visits(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  doctor_id uuid REFERENCES public.doctors(id),
  test_id uuid NOT NULL REFERENCES public.lab_tests(id),
  priority text NOT NULL DEFAULT 'routine',
  status text NOT NULL DEFAULT 'ordered',
  result text,
  result_flag text,
  notes text NOT NULL DEFAULT '',
  price numeric(12,2) NOT NULL DEFAULT 0,
  cancel_reason text,
  resulted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX orders_patient ON public.orders (patient_id, created_at DESC);
CREATE INDEX orders_visit ON public.orders (visit_id);
CREATE INDEX orders_status ON public.orders (hospital_id, status);

GRANT SELECT ON public.lab_tests, public.orders TO authenticated;
GRANT ALL ON public.lab_tests, public.orders TO service_role;
ALTER TABLE public.lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital staff read lab tests" ON public.lab_tests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = lab_tests.hospital_id AND r.role <> 'patient'));
CREATE POLICY "Clinical, lab and billing staff read orders" ON public.orders FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = orders.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator','lab_tech','cashier','receptionist','admin','super_admin')));
CREATE POLICY "Patients read own verified orders" ON public.orders FOR SELECT TO authenticated USING (
  orders.status = 'verified' AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = orders.patient_id AND p.user_id = auth.uid()));

-- Starter catalogue for every existing hospital (prices are placeholders to edit).
INSERT INTO public.lab_tests (hospital_id, code, name, category, sample_type, price, reference_range, turnaround_hours)
SELECT h.id, t.code, t.name, t.category, t.sample_type, t.price, t.reference_range, t.tat
FROM public.hospitals h CROSS JOIN (VALUES
  ('CBC','Complete blood count','lab','Blood (EDTA)',800,'Hb 12-17 g/dL; WBC 4-11 ×10⁹/L; Plt 150-400 ×10⁹/L',4),
  ('LFT','Liver function tests','lab','Blood (serum)',1500,'ALT <40 U/L; Bilirubin <1.2 mg/dL',6),
  ('RFT','Renal function tests','lab','Blood (serum)',1200,'Urea 15-45 mg/dL; Creatinine 0.6-1.2 mg/dL',6),
  ('NS1','Dengue NS1 antigen','lab','Blood (serum)',1800,'Negative',4),
  ('DENGUE-IGM','Dengue IgG / IgM','lab','Blood (serum)',2000,'Negative',6),
  ('MP','Malaria parasite (smear / ICT)','lab','Blood (EDTA)',500,'Not seen',2),
  ('TYPHIDOT','Typhidot (IgM)','lab','Blood (serum)',1200,'Negative',4),
  ('CRP','C-reactive protein','lab','Blood (serum)',900,'<5 mg/L',4),
  ('ESR','Erythrocyte sedimentation rate','lab','Blood (EDTA)',300,'0-20 mm/hr',2),
  ('RBS','Random blood sugar','lab','Blood (fluoride)',200,'<140 mg/dL',1),
  ('FBS','Fasting blood sugar','lab','Blood (fluoride)',200,'70-100 mg/dL',1),
  ('HBA1C','HbA1c','lab','Blood (EDTA)',1500,'<5.7 %',24),
  ('LIPID','Lipid profile','lab','Blood (serum)',1600,'Cholesterol <200 mg/dL; TG <150 mg/dL',6),
  ('ELECTRO','Serum electrolytes','lab','Blood (serum)',1000,'Na 135-145; K 3.5-5.0 mmol/L',4),
  ('TFT','Thyroid profile (TSH, T3, T4)','lab','Blood (serum)',2500,'TSH 0.4-4.0 mIU/L',24),
  ('URINE-RE','Urine routine examination','lab','Urine',300,'Normal',2),
  ('HBSAG','Hepatitis B surface antigen','lab','Blood (serum)',800,'Non-reactive',4),
  ('ANTI-HCV','Anti-HCV antibodies','lab','Blood (serum)',800,'Non-reactive',4),
  ('XR-CHEST','X-ray chest PA view','radiology',NULL,1000,NULL,2),
  ('US-ABD','Ultrasound whole abdomen','radiology',NULL,2500,NULL,4),
  ('ECG','ECG 12-lead','radiology',NULL,600,NULL,1)
) AS t(code, name, category, sample_type, price, reference_range, tat)
ON CONFLICT DO NOTHING;