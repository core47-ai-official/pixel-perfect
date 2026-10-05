CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE public.icd10_codes (
  code text PRIMARY KEY,
  description text NOT NULL,
  chapter text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX icd10_desc_trgm ON public.icd10_codes USING gin (description extensions.gin_trgm_ops);
CREATE INDEX icd10_code_prefix ON public.icd10_codes (code text_pattern_ops);

CREATE TABLE public.visit_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  visit_id uuid NOT NULL REFERENCES public.visits(id),
  icd10_code text NOT NULL REFERENCES public.icd10_codes(code),
  description text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX visit_diagnoses_unique ON public.visit_diagnoses (visit_id, icd10_code);
CREATE UNIQUE INDEX visit_diagnoses_one_primary ON public.visit_diagnoses (visit_id) WHERE is_primary;

GRANT SELECT ON public.icd10_codes, public.visit_diagnoses TO authenticated;
GRANT ALL ON public.icd10_codes, public.visit_diagnoses TO service_role;
ALTER TABLE public.icd10_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users read ICD-10 codes" ON public.icd10_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Clinical staff read diagnoses" ON public.visit_diagnoses FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.hospital_id = visit_diagnoses.hospital_id
          AND r.role IN ('doctor','dept_head','nurse','er_officer','ot_coordinator')));
CREATE POLICY "Patients read own diagnoses" ON public.visit_diagnoses FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.visits v JOIN public.patients p ON p.id = v.patient_id
          WHERE v.id = visit_diagnoses.visit_id AND v.status = 'completed' AND p.user_id = auth.uid()));

-- Starter set of common codes so the screen works before the full WHO list is imported.
INSERT INTO public.icd10_codes (code, description, chapter) VALUES
('A09','Infectious gastroenteritis and colitis, unspecified','I'),
('A01.0','Typhoid fever','I'),
('A15.0','Tuberculosis of lung','I'),
('A90','Dengue fever [classical dengue]','I'),
('A91','Dengue haemorrhagic fever','I'),
('B15.9','Hepatitis A without hepatic coma','I'),
('B17.1','Acute hepatitis C','I'),
('B18.1','Chronic viral hepatitis B without delta-agent','I'),
('B18.2','Chronic viral hepatitis C','I'),
('B50.9','Plasmodium falciparum malaria, unspecified','I'),
('B54','Unspecified malaria','I'),
('B86','Scabies','I'),
('D50.9','Iron deficiency anaemia, unspecified','III'),
('D64.9','Anaemia, unspecified','III'),
('E03.9','Hypothyroidism, unspecified','IV'),
('E05.9','Thyrotoxicosis, unspecified','IV'),
('E10.9','Type 1 diabetes mellitus without complications','IV'),
('E11.9','Type 2 diabetes mellitus without complications','IV'),
('E11.65','Type 2 diabetes mellitus with hyperglycaemia','IV'),
('E55.9','Vitamin D deficiency, unspecified','IV'),
('E66.9','Obesity, unspecified','IV'),
('E78.5','Hyperlipidaemia, unspecified','IV'),
('E86','Volume depletion (dehydration)','IV'),
('F32.9','Depressive episode, unspecified','V'),
('F41.1','Generalized anxiety disorder','V'),
('G43.9','Migraine, unspecified','VI'),
('G40.9','Epilepsy, unspecified','VI'),
('H10.9','Conjunctivitis, unspecified','VII'),
('H66.9','Otitis media, unspecified','VIII'),
('I10','Essential (primary) hypertension','IX'),
('I20.9','Angina pectoris, unspecified','IX'),
('I21.9','Acute myocardial infarction, unspecified','IX'),
('I50.9','Heart failure, unspecified','IX'),
('I63.9','Cerebral infarction, unspecified','IX'),
('J00','Acute nasopharyngitis [common cold]','X'),
('J02.9','Acute pharyngitis, unspecified','X'),
('J03.9','Acute tonsillitis, unspecified','X'),
('J06.9','Acute upper respiratory infection, unspecified','X'),
('J18.9','Pneumonia, unspecified','X'),
('J20.9','Acute bronchitis, unspecified','X'),
('J45.9','Asthma, unspecified','X'),
('J44.9','Chronic obstructive pulmonary disease, unspecified','X'),
('K21.9','Gastro-oesophageal reflux disease without oesophagitis','XI'),
('K29.7','Gastritis, unspecified','XI'),
('K35.8','Acute appendicitis, other and unspecified','XI'),
('K59.0','Constipation','XI'),
('K80.2','Calculus of gallbladder without cholecystitis','XI'),
('L20.9','Atopic dermatitis, unspecified','XII'),
('L30.9','Dermatitis, unspecified','XII'),
('M54.5','Low back pain','XIII'),
('M17.9','Gonarthrosis, unspecified','XIII'),
('M79.1','Myalgia','XIII'),
('N18.9','Chronic kidney disease, unspecified','XIV'),
('N20.0','Calculus of kidney','XIV'),
('N39.0','Urinary tract infection, site not specified','XIV'),
('O80','Single spontaneous delivery','XV'),
('O21.0','Mild hyperemesis gravidarum','XV'),
('O24.4','Diabetes mellitus arising in pregnancy','XV'),
('P59.9','Neonatal jaundice, unspecified','XVI'),
('R05','Cough','XVIII'),
('R10.4','Other and unspecified abdominal pain','XVIII'),
('R50.9','Fever, unspecified','XVIII'),
('R51','Headache','XVIII'),
('R11','Nausea and vomiting','XVIII'),
('S52.5','Fracture of lower end of radius','XIX'),
('S93.4','Sprain and strain of ankle','XIX'),
('T14.1','Open wound of unspecified body region','XIX'),
('Z00.0','General medical examination','XXI'),
('Z34.9','Supervision of normal pregnancy, unspecified','XXI');