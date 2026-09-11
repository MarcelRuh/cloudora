"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monacoLanguage } from "@/lib/file-kinds";
import type { ExplorerEntry } from "@/lib/types";
import { api } from "@/lib/api";

export function PreviewModal({ entry, onClose }: { entry: ExplorerEntry; onClose: () => void }) {
  const src = `/api/files/preview?path=${encodeURIComponent(entry.path)}`;
  const text = useQuery({
    queryKey: ["preview", entry.path],
    queryFn: () => api<{ kind: string; name: string; content: string }>(src),
    enabled: entry.kind === "text" || entry.kind === "code",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="cloudora-panel flex max-h-[90vh] w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="cloudora-section">Vorschau</p>
            <h2 className="text-sm font-semibold">{entry.name}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {entry.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={entry.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg" />
          ) : null}
          {entry.kind === "pdf" ? <iframe title={entry.name} src={src} className="h-[70vh] w-full rounded-lg bg-white" /> : null}
          {entry.kind === "video" ? (
            <video src={src} controls className="mx-auto max-h-[70vh] w-full rounded-lg" />
          ) : null}
          {entry.kind === "audio" ? <audio src={src} controls className="w-full" /> : null}
          {(entry.kind === "text" || entry.kind === "code") && text.data ? (
            <pre className="overflow-auto rounded-lg bg-black/40 p-4 font-mono text-xs leading-6">
              <code data-lang={monacoLanguage(entry.name)}>{text.data.content}</code>
            </pre>
          ) : null}
          {text.isError ? <p className="text-sm text-destructive">Vorschau konnte nicht geladen werden.</p> : null}
        </div>
      </div>
    </div>
  );
}
