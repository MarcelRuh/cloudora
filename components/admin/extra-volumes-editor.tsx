"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PathPickerField } from "@/components/admin/path-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";

export type ExtraVolume = { id: string; name: string; hostPath: string };

function slugFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function ExtraVolumesEditor({
  volumes,
  storagePath,
}: {
  volumes: ExtraVolume[];
  storagePath: string;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ExtraVolume[]>(volumes);
  const [name, setName] = useState("");
  const [hostPath, setHostPath] = useState("/mnt");

  useEffect(() => setRows(volumes), [volumes]);

  const save = useMutation({
    mutationFn: (apply: boolean) =>
      api<{ extraVolumes: ExtraVolume[]; apply?: { mode: string; message: string } }>("/api/admin/storage/volumes", {
        method: "PUT",
        body: JSON.stringify({ extraVolumes: rows, apply }),
      }),
    onSuccess: (res, apply) => {
      setRows(res.extraVolumes);
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
      qc.invalidateQueries({ queryKey: ["linux-browse"] });
      toast.success(apply ? res.apply?.message || "Volumes übernommen" : "Volumes gespeichert");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  function addRow() {
    const id = slugFromName(name);
    if (!id) {
      toast.error("Name fehlt.");
      return;
    }
    if (hostPath.trim() === "/" || !hostPath.trim()) {
      toast.error("Wähle einen Ordner unter /, nicht die Wurzel selbst.");
      return;
    }
    if (rows.some((row) => row.id === id)) {
      toast.error("Dieser Name ist schon vergeben.");
      return;
    }
    setRows((current) => [...current, { id, name: name.trim() || id, hostPath: hostPath.trim() }]);
    setName("");
    setHostPath("/mnt");
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="cloudora-section">Zusätzliche Speicher</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Host-Ordner aus Linux / wählen und linken. `/host` ist nur zum Durchsuchen (lesen). Nach dem Übernehmen liegen die Ordner schreibbar im Explorer unter{" "}
          <span className="font-mono">/volumes/…</span>. `.env` und der Storage-Root bleiben.
        </p>
      </div>
      <ul className="divide-y divide-white/5 rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{row.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {row.hostPath} → {storagePath.replace(/\/+$/, "")}/volumes/{row.id}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Entfernen
            </Button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted-foreground">Noch keine Extra-Volumes.</li>
        ) : null}
      </ul>
      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="hdd" />
        </div>
        <PathPickerField
          label="Host-Ordner"
          value={hostPath}
          onChange={setHostPath}
          storageRoot={storagePath}
          placeholder="/mnt/daten"
          hint="Linux / öffnet den Host. Einen Unterordner wählen."
        />
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            Hinzufügen
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>
          Speichern
        </Button>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>
          {save.isPending ? "…" : "Speichern und übernehmen"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Übernehmen schreibt die Bind-Mounts und startet den App-Container neu (Sidecar). Ohne Sidecar: einmal{" "}
        <span className="font-mono">docker compose up -d --no-build</span>.
      </p>
    </Card>
  );
}
