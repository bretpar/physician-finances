import logo from "@/assets/logo-paycheckmd.png";
import { cn } from "@/lib/utils";

/** Paycheck MD brand mark — square logo, used wherever the app needs a brand glyph. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src={logo}
      alt="Paycheck MD"
      className={cn("h-9 w-9 rounded-lg object-fill", className)}
    />
  );
}
