/** Specialty note templates for the consultation screen. Text is clinical English (notes are written in English). */
export interface NoteTemplate {
  id: string;
  /** Doctor specialties (lower-case substrings) that get this template suggested first. */
  match: string[];
  fields: { history: string; examination: string; plan: string };
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  { id: "general", match: ["general", "medicine", "family"], fields: {
    history: "Onset/duration:\nAssociated symptoms:\nPast history:\nDrug history:\nAllergies:\nFamily/social history:",
    examination: "General appearance:\nChest:\nCVS:\nAbdomen:\nCNS:",
    plan: "Investigations:\nTreatment:\nAdvice:\nFollow-up:" } },
  { id: "pediatrics", match: ["paed", "pediat", "child"], fields: {
    history: "Onset/duration:\nFeeding:\nImmunisation status:\nBirth history:\nDevelopment milestones:\nAllergies:",
    examination: "Weight/height centile:\nHydration:\nChest:\nAbdomen:\nENT:",
    plan: "Investigations:\nTreatment (weight-based doses):\nAdvice to parents:\nFollow-up:" } },
  { id: "gynae", match: ["gyn", "obstet"], fields: {
    history: "LMP:\nGravida/Para:\nMenstrual history:\nContraception:\nPast obstetric history:\nAllergies:",
    examination: "General:\nAbdomen (fundal height if pregnant):\nPelvic (if indicated, with chaperone):",
    plan: "Investigations:\nTreatment:\nAntenatal advice:\nFollow-up:" } },
  { id: "cardiology", match: ["cardio"], fields: {
    history: "Chest pain (site, radiation, exertion):\nBreathlessness (NYHA):\nPalpitations/syncope:\nRisk factors (HTN, DM, smoking, lipids):\nAllergies:",
    examination: "JVP:\nHeart sounds/murmurs:\nPeripheral pulses:\nOedema:\nLung bases:",
    plan: "ECG/Echo:\nTreatment:\nLifestyle advice:\nFollow-up:" } },
  { id: "ortho", match: ["ortho"], fields: {
    history: "Injury/mechanism:\nPain (site, severity):\nFunction/limitations:\nAllergies:",
    examination: "Look:\nFeel:\nMove (range):\nNeurovascular status:",
    plan: "X-ray/imaging:\nTreatment (splint/cast/meds):\nPhysiotherapy:\nFollow-up:" } },
];

export function templateForSpecialty(specialty: string | null | undefined): NoteTemplate {
  const s = (specialty ?? "").toLowerCase();
  return NOTE_TEMPLATES.find((t) => t.match.some((m) => s.includes(m))) ?? NOTE_TEMPLATES[0]!;
}
