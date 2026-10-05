import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Ltr } from "@/components/mc/ltr";
import { ageFrom, type Patient } from "@/lib/patients";

/** Bilingual registration slip (English, then the patient's print language). */
export function RegistrationSlip({ patient, open, onOpenChange }: { patient: Patient; open: boolean; onOpenChange: (o: boolean) => void }) {
  const brand = usePrintBrand();
  const age = ageFrom(patient.dob);
  const date = new Date(patient.created_at);
  const when = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  return (
    <PrintPreviewPanel
      open={open}
      onOpenChange={onOpenChange}
      brand={brand}
      printLanguage={patient.print_language === "ur" ? "ur" : null}
      qrValue={patient.mrn}
      job={{ documentType: "registration_slip", documentId: patient.mrn, patientId: patient.id }}
    >
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt("print.slip.title")}</p>
          <p className="text-center text-lg font-bold"><Ltr>{patient.mrn}</Ltr></p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>{pt("print.slip.name")}</span><span className="text-end">{patient.full_name}</span>
            {patient.father_or_husband_name && <><span>{pt("print.slip.father")}</span><span className="text-end">{patient.father_or_husband_name}</span></>}
            {age !== null && <><span>{pt("print.slip.age")}</span><span className="text-end"><Ltr>{age}</Ltr></span></>}
            {patient.gender && <><span>{pt("print.slip.gender")}</span><span className="text-end">{pt(`print.slip.g.${patient.gender}`)}</span></>}
            {patient.cnic && <><span>{pt("print.slip.cnic")}</span><span className="text-end"><Ltr>{patient.cnic}</Ltr></span></>}
            {patient.phone && <><span>{pt("print.slip.phone")}</span><span className="text-end"><Ltr>{patient.phone}</Ltr></span></>}
            {patient.blood_group && <><span>{pt("print.slip.blood")}</span><span className="text-end"><Ltr>{patient.blood_group}</Ltr></span></>}
            <span>{pt("print.slip.date")}</span><span className="text-end"><Ltr>{when}</Ltr></span>
          </div>
          {patient.allergies.length > 0 && (
            <p className="mc-rule border-t pt-1 font-semibold">{pt("print.slip.allergies")}: <Ltr>{patient.allergies.join(", ")}</Ltr></p>
          )}
          <p className="mc-rule border-t pt-1 text-center text-xs">{pt("print.slip.keep")}</p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
