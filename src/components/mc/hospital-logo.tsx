import { useState } from "react";
import { Hospital } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Hospital logo from company settings. Placeholder mark until settings exist. */
export function HospitalLogo({ src, className }: { src?: string | null; className?: string }) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState<string | null>(null);
  if (src && broken !== src) return <img src={src} onError={() => setBroken(src)} alt={t("auth.hospitalLogo")} className={cn("h-12 w-12 rounded-md object-contain", className)} />;
  return (
    <div
      role="img"
      aria-label={t("auth.hospitalLogo")}
      className={cn("flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}
    >
      <Hospital className="h-6 w-6" aria-hidden />
    </div>
  );
}
