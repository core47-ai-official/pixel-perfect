import { cn } from "@/lib/utils";

/** Keeps numbers, MRN, CNIC, phone and drug names in English/LTR inside Urdu layouts. */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("ltr-code tnum", className)}>
      {children}
    </bdi>
  );
}
