"use client";

import { ChevronDown, ChevronUp, Download, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatBytes, formatSpeed } from "@/lib/format";
import type { TransferItem } from "@/lib/transfer";
import { cn } from "@/lib/utils";
import { useTransfers } from "@/components/transfers/transfer-provider";

export function TransferSidebar() {
  const { items, remove } = useTransfers();
  const [expanded, setExpanded] = useState(true);
  const activeIds = items
    .filter((item) => !item.done && !item.error)
    .map((item) => item.id)
    .join("|");

  useEffect(() => {
    if (activeIds) setExpanded(true);
  }, [activeIds]);

  const summary = useMemo(() => summarize(items), [items]);
  if (!items.length) return null;

  return (
    <div className="shrink-0 border-t border-[var(--ui-chrome-border)] px-3 py-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        {summary.kind === "download" ? (
          <Download className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <Upload className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider">
          {summary.title}
        </span>
        {((summary.multiple || !expanded) && summary.percent != null) ? (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">{summary.percent}%</span>
        ) : null}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {!expanded ? (
        <div className="mt-2">
          <Gauge item={summary.lead} compact />
          {summary.speedLabel ? <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{summary.speedLabel}</p> : null}
        </div>
      ) : (
        <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-0.5">
          {items.map((item) => (
            <TransferRow
              key={item.id}
              item={item}
              showPercent={summary.multiple}
              onDismiss={() => remove(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TransferRow({
  item,
  showPercent,
  onDismiss,
}: {
  item: TransferItem;
  showPercent: boolean;
  onDismiss: () => void;
}) {
  const unknown = item.total == null || item.total <= 0;
  return (
    <div>
      <div className="mb-1 flex items-start gap-1.5">
        {item.kind === "download" ? (
          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <p className="min-w-0 flex-1 break-words text-xs font-medium leading-snug">{item.name}</p>
        {item.error || item.done ? (
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss} aria-label="Entfernen">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : showPercent && !unknown ? (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">{item.progress}%</span>
        ) : null}
      </div>
      <Gauge item={item} />
      <p className={cn("mt-1 text-[11px] leading-relaxed", item.error ? "text-destructive" : "text-muted-foreground")}>
        {item.error ? (
          item.error
        ) : item.done ? (
          "Fertig"
        ) : unknown ? (
          <>
            <span className="block tabular-nums">{formatBytes(item.loaded)}</span>
            <span className="block tabular-nums">{formatSpeed(item.speedBps)}</span>
          </>
        ) : (
          <>
            <span className="block tabular-nums">
              {showPercent ? `${formatBytes(item.loaded)} / ${formatBytes(item.total)}` : `${item.progress}% · ${formatBytes(item.loaded)} / ${formatBytes(item.total)}`}
            </span>
            <span className="block tabular-nums">{formatSpeed(item.speedBps)}</span>
          </>
        )}
      </p>
    </div>
  );
}

function Gauge({ item, compact }: { item?: TransferItem | null; compact?: boolean }) {
  if (!item) return null;
  const unknown = (item.total == null || item.total <= 0) && !item.done && !item.error;
  return (
    <div className={cn("cloudora-gauge", compact && "h-1.5", unknown && "cloudora-gauge-indeterminate")}>
      <span style={{ width: unknown ? undefined : `${item.error ? 100 : item.progress}%` }} />
    </div>
  );
}

function summarize(items: TransferItem[]) {
  const active = items.filter((item) => !item.done && !item.error);
  const uploads = active.filter((item) => item.kind === "upload").length;
  const downloads = active.filter((item) => item.kind === "download").length;
  const lead = active[0] ?? items[items.length - 1] ?? null;
  const known = active.filter((item) => item.total && item.total > 0);
  const loadedSum = known.reduce((sum, item) => sum + item.loaded, 0);
  const totalSum = known.reduce((sum, item) => sum + (item.total ?? 0), 0);
  const percent = totalSum > 0 ? Math.min(100, Math.round((loadedSum / totalSum) * 100)) : null;
  const multiple = items.length > 1;
  const speed = active.reduce((sum, item) => sum + (item.speedBps || 0), 0);
  const title =
    uploads && downloads ? "Übertragungen" : downloads ? (downloads > 1 ? "Downloads" : "Download") : uploads > 1 ? "Uploads" : "Upload";
  return {
    title,
    kind: downloads && !uploads ? ("download" as const) : ("upload" as const),
    percent,
    multiple,
    active: active.length > 0,
    lead:
      lead && percent != null
        ? { ...lead, progress: percent, total: totalSum || lead.total, loaded: loadedSum || lead.loaded }
        : lead,
    speedLabel: active.length ? formatSpeed(speed) : null,
  };
}
