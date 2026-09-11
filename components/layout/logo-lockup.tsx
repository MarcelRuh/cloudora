import { BrandMark } from "@/components/layout/brand-mark";
import { APP_NAME } from "@/lib/version";
import { cn } from "@/lib/utils";

export function LogoLockup({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <BrandMark className={compact ? "h-8 w-8" : "h-11 w-11"} size={compact ? 32 : 44} />
      <div className="min-w-0">
        <p className="cloudora-logo text-lg leading-none">{APP_NAME.toUpperCase()}</p>
        {compact ? null : (
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-sidebar-muted">
            Self-Hosted Cloud
          </p>
        )}
      </div>
    </div>
  );
}
