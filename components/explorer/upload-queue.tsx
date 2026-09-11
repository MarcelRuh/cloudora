"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  error?: string;
};

export function UploadQueue({ items }: { items: UploadItem[] }) {
  const [open, setOpen] = useState(true);
  if (!items.length || !open) return null;
  return (
    <div className="cloudora-panel fixed bottom-4 right-4 z-40 w-80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Uploading…</p>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Schließen
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="truncate">{item.name}</span>
              <span>{item.error ? "Fehler" : `${item.progress}%`}</span>
            </div>
            <div className="cloudora-gauge">
              <span style={{ width: `${item.progress}%` }} />
            </div>
            {item.error ? <p className="mt-1 text-xs text-destructive">{item.error}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
