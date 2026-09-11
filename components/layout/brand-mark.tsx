import { APP_NAME } from "@/lib/version";
import { cn } from "@/lib/utils";

export function BrandMark({ className = "h-11 w-11", size }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt={APP_NAME}
      width={size ?? 44}
      height={size ?? 44}
      className={cn("shrink-0 object-contain", className)}
      style={{ filter: "var(--ui-logo-glow)" }}
    />
  );
}
