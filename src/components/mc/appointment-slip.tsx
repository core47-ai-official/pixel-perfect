import { PrintPreviewPanel, usePrintBrand } from "@/components/mc/print-document";
import { Ltr } from "@/components/mc/ltr";
import { pkDate } from "@/lib/appointments";
import type { BookedAppointment } from "@/lib/appointments";

interface SlipPatient { id: string; full_name: string; mrn: string; print_language: string | null }

/** Bilingual appointment slip: token, doctor, time, fee. */
export function AppointmentSlip({ appt, patient, open, onOpenChange }: {
  appt: BookedAppointment; patient: SlipPatient; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const brand = usePrintBrand();
  const [y, m, d] = pkDate(appt.slot_start).split("-");
  return (
    <PrintPreviewPanel
      open={open} onOpenChange={onOpenChange} brand={brand}
      printLanguage={patient.print_language === "ur" ? "ur" : null}
      qrValue={patient.mrn}
      job={{ documentType: "appointment_slip", documentId: appt.id, patientId: patient.id }}
    >
      {(pt) => (
        <div className="space-y-2">
          <p className="text-center font-bold uppercase">{pt("print.appt.title")}</p>
          <p className="text-center text-xs">{pt("print.appt.token")}</p>
          <p className="text-center text-3xl font-bold"><Ltr>{appt.token_no ?? "—"}</Ltr></p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>{pt("print.slip.name")}</span><span className="text-end">{patient.full_name}</span>
            <span>MRN</span><span className="text-end"><Ltr>{patient.mrn}</Ltr></span>
            <span>{pt("print.appt.doctor")}</span><span className="text-end">{appt.doctor_name ?? "—"}</span>
            {appt.department_name && <><span>{pt("print.appt.department")}</span><span className="text-end">{appt.department_name}</span></>}
            <span>{pt("print.appt.date")}</span><span className="text-end"><Ltr>{`${d}/${m}/${y}`}</Ltr></span>
            <span>{pt("print.appt.time")}</span><span className="text-end"><Ltr>{appt.time}</Ltr></span>
            {appt.room && <><span>{pt("print.appt.room")}</span><span className="text-end"><Ltr>{appt.room}</Ltr></span></>}
            <span>{pt("print.appt.type")}</span><span className="text-end">{pt(`print.appt.types.${appt.type}`)}</span>
            <span className="font-semibold">{pt("print.appt.fee")}</span><span className="text-end font-semibold"><Ltr>{`Rs ${Number(appt.fee).toLocaleString("en-PK")}`}</Ltr></span>
          </div>
          <p className="mc-rule border-t pt-1 text-center text-xs">{pt("print.appt.arrive")}</p>
        </div>
      )}
    </PrintPreviewPanel>
  );
}
