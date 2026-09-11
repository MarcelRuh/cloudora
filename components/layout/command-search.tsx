"use client";

import { useQuery } from "@tanstack/react-query";
import { FileIcon, Folder } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import type { ExplorerEntry } from "@/lib/types";

export function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<{ items: ExplorerEntry[] }>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length > 0,
  });

  function close() {
    setQ("");
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={close}>
      <div className="cloudora-panel w-full max-w-xl p-4" onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          placeholder="Dateien und Ordner suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-3 max-h-80 overflow-y-auto">
          {(data?.items ?? []).map((item) => (
            <button
              key={item.path}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
              onClick={() => {
                close();
                router.push(item.isDir ? `/files?path=${encodeURIComponent(item.path)}` : `/files?path=${encodeURIComponent(item.path)}&preview=1`);
              }}
            >
              {item.isDir ? <Folder className="h-4 w-4 text-primary" /> : <FileIcon className="h-4 w-4 text-accent" />}
              <span className="truncate">{item.name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{item.path}</span>
            </button>
          ))}
          {q && data && data.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Keine Treffer.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
