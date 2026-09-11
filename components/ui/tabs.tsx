"use client";

import { cn } from "@/lib/utils";

export function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex flex-wrap gap-1 border-b border-border", className)}>
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-display text-[11px] uppercase tracking-[0.14em] transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              tab.disabled && "pointer-events-none opacity-40",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
