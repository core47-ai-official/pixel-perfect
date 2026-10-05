import { useEffect, useRef } from "react";

/** Code 128 barcode rendered as SVG (browser only; draws after mount). */
export function Barcode({ value, height = 48 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let alive = true;
    void import("jsbarcode").then(({ default: JsBarcode }) => {
      if (alive && ref.current) JsBarcode(ref.current, value, { format: "CODE128", height, width: 1.6, margin: 0, displayValue: true, fontSize: 12, background: "transparent" });
    });
    return () => { alive = false; };
  }, [value, height]);
  return <svg ref={ref} className="mx-auto max-w-full" aria-label={value} />;
}
