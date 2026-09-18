"use client";

import { useQuery } from "@tanstack/react-query";
import { FileIcon, Folder } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { isAdministrator } from "@/lib/permissions";
import type { ExplorerEntry, SessionUser } from "@/lib/types";

export function CommandSearch({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: SessionUser;
}) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const isAdmin = isAdministrator(user);
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
                router.push(`/files?path=${encodeURIComponent(item.path)}`);
              }}
            >
              {item.isDir ? <Folder className="h-4 w-4 text-primary" /> : <FileIcon className="h-4 w-4 text-accent" />}
              <span className="truncate">{item.displayName || item.name}</span>
              {isAdmin && item.mount?.hostPath ? (
                <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{item.mount.hostPath}</span>
              ) : null}
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
