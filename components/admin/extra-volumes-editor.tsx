"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PathPickerField } from "@/components/admin/path-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";

export type ExtraVolume = { id: string; name: string; hostPath: string };

function nameFromHostPath(hostPath: string) {
  return hostPath.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.slice(0, 64) || "daten";
}

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
      toast.success(apply ? res.apply?.message || "Host-Ordner übernommen" : "Host-Ordner gespeichert");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  function addRow() {
    const host = hostPath.trim();
    if (host === "/" || !host) {
      toast.error("Wähle einen Ordner unter /, nicht die Wurzel selbst.");
      return;
    }
    const label = name.trim() || nameFromHostPath(host);
    const id = slugFromName(label);
    if (!id) {
      toast.error("Name fehlt.");
      return;
    }
    if (rows.some((row) => row.id === id || row.hostPath === host)) {
      toast.error("Dieser Name oder Host-Pfad ist schon vergeben.");
      return;
    }
    setRows((current) => [...current, { id, name: label, hostPath: host }]);
    setName("");
    setHostPath("/mnt");
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="cloudora-section">Host-Ordner</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Beliebiger Ordner auf dem Linux-Host. <span className="font-mono">/mnt</span>,{" "}
          <span className="font-mono">/media</span> und <span className="font-mono">/srv</span> sind im Container
          schreibbar — Ordner anlegen und nutzen ohne Neustart. Andere Pfade (z. B. unter /home) brauchen weiterhin einen Bind.
        </p>
      </div>
      <ul className="divide-y divide-white/5 rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <HardDrive className="h-4 w-4 text-primary" />
                <span className="truncate font-mono">{row.hostPath}</span>
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  Host-Ordner
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {row.name} → /volumes/{row.id}
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
          <li className="px-3 py-4 text-sm text-muted-foreground">
            Noch kein Host-Ordner. Einen Pfad unter /mnt, /media, /srv oder /home wählen.
          </li>
        ) : null}
      </ul>
      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="leer = letzter Pfadteil" />
        </div>
        <PathPickerField
          label="Host-Ordner"
          value={hostPath}
          onChange={setHostPath}
          storageRoot={storagePath}
          placeholder="/mnt/nas oder /media/usb"
          hint="Linux / listet den Host. Unter /mnt, /media und /srv kannst du Ordner direkt anlegen."
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
        Übernehmen speichert die Host-Ordner. Unter /mnt, /media und /srv sofort nutzbar. Andere Pfade starten den App-Container neu.
      </p>
    </Card>
  );
}
