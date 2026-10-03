import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const digits = (v: string) => v.replace(/\D/g, "");

export function formatCnic(v: string) {
  const d = digits(v).slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/** Pakistani mobile: +92 3XX XXXXXXX. Accepts 03..., 3..., 92..., +92... */
export function formatPhone(v: string) {
  let d = digits(v);
  if (d.startsWith("92")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 10);
  if (!d) return "";
  return d.length <= 3 ? `+92 ${d}` : `+92 ${d.slice(0, 3)} ${d.slice(3)}`;
}

type MaskedProps = Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
  value: string;
  onValueChange: (v: string) => void;
};

export function CnicInput({ value, onValueChange, className, ...p }: MaskedProps) {
  return (
    <Input
      inputMode="numeric"
      placeholder="XXXXX-XXXXXXX-X"
      value={value}
      onChange={(e) => onValueChange(formatCnic(e.target.value))}
      className={cn("tnum ltr-code", className)}
      {...p}
    />
  );
}

export function PhoneInput({ value, onValueChange, className, ...p }: MaskedProps) {
  return (
    <Input
      inputMode="tel"
      placeholder="+92 3XX XXXXXXX"
      value={value}
      onChange={(e) => onValueChange(formatPhone(e.target.value))}
      className={cn("tnum ltr-code", className)}
      {...p}
    />
  );
}
