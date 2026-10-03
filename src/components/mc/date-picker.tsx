import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
}: {
  value?: Date | undefined;
  onChange: (d?: Date) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={cn("w-full justify-start text-start font-normal tnum", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon />
          {value ? format(value, "dd MMM yyyy") : (placeholder ?? t("common.pickDate"))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={onChange} className="p-3 pointer-events-auto" />
      </PopoverContent>
    </Popover>
  );
}
