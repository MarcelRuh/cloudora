"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { APP_VERSION } from "@/lib/version";

type Info = {
  version: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  node: string;
  uptimeSeconds: number;
  storagePathConfigured: string;
  hostStorageConfigured: string;
  usersDir: string;
  sharedDir: string;
  storageExists: boolean;
  storageBytes: number;
  storageTotalBytes: number | null;
  storageFreeBytes: number | null;
  storageLow: boolean;
  database: string;
  databaseBytes: number | null;
  docker: boolean;
  publicUrl: string;
};

type BackupInfo = {
  lastBackupAt: string | null;
  hostStorage: string;
  storagePath: string;
  note: string;
};

export function SystemView() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["system"], queryFn: () => api<Info>("/api/admin/system") });
  const backup = useQuery({ queryKey: ["backup"], queryFn: () => api<BackupInfo>("/api/admin/backup") });
  const dump = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/backup", { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Backup fehlgeschlagen.");
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cloudora-db-${stamp}.sql`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast.success("Datenbank-Dump heruntergeladen");
      qc.invalidateQueries({ queryKey: ["backup"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Fehler"),
  });
  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Administration</p>
        <h1 className="cloudora-title text-2xl">System</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="cloudora-section">Cloudora</p>
          <p className="cloudora-stat mt-2 text-3xl">v{data?.currentVersion ?? APP_VERSION}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Neueste Version: {data?.latestVersion ?? "nicht prüfbar"}
          </p>
          {data?.updateAvailable ? (
            <a className="mt-3 inline-block text-sm text-primary" href={data.releaseUrl ?? "https://github.com/MarcelRuh/cloudora"} target="_blank" rel="noreferrer">
              Update auf GitHub ansehen
            </a>
          ) : (
            <p className="mt-3 text-sm text-success">Aktuell</p>
          )}
        </Card>
        <Card>
          <p className="cloudora-section">Laufzeit</p>
          <dl className="mt-3 space-y-2 text-sm">
            <Row k="Node.js" v={data?.node} />
            <Row k="Uptime" v={data ? `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m` : "—"} />
            <Row k="Docker" v={data?.docker ? "ja" : "nein"} />
            <Row k="Datenbank" v={data?.database} />
            <Row k="DB-Größe" v={data?.databaseBytes != null ? formatBytes(data.databaseBytes) : "—"} />
          </dl>
        </Card>
        <Card className="md:col-span-2">
          <p className="cloudora-section">Storage</p>
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <Row k="Host-Mount" v={data?.hostStorageConfigured} />
            <Row k="Container-Pfad" v={data?.storagePathConfigured} />
            <Row k="Benutzer-Ordner" v={data?.usersDir} />
            <Row k="Shared-Ordner" v={data?.sharedDir} />
            <Row k="Vorhanden" v={data?.storageExists ? "ja" : "nein"} />
            <Row k="Belegt" v={data ? formatBytes(data.storageBytes) : "—"} />
            <Row k="Kapazität" v={data?.storageTotalBytes != null ? formatBytes(data.storageTotalBytes) : "—"} />
            <Row k="Frei" v={data?.storageFreeBytes != null ? formatBytes(data.storageFreeBytes) : "—"} />
            <Row k="Public URL" v={data?.publicUrl} />
          </dl>
          {data?.storageLow ? (
            <p className="mt-3 text-sm text-warning">
              Speicherplatz knapp: weniger als 1 GB oder unter 10 % frei. Dateien oder den Host-Mount prüfen.
            </p>
          ) : null}
          <p className="mt-4 text-xs text-muted-foreground">
            Speicherort über `CLOUDORA_HOST_STORAGE` (Host-Mount) und `CLOUDORA_STORAGE_PATH` (Container). Extra-Volumes in
            `docker-compose.override.yml`. Updates erhalten `.env` und das Storage-Volume.
          </p>
        </Card>
        <Card className="md:col-span-2">
          <p className="cloudora-section">Backup</p>
          <p className="mt-2 text-sm text-muted-foreground">{backup.data?.note}</p>
          <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <Row k="Letzter DB-Dump" v={backup.data?.lastBackupAt ? formatDateTime(backup.data.lastBackupAt) : "noch keiner"} />
            <Row k="Dateien sichern unter" v={backup.data?.hostStorage} />
          </dl>
          <Button className="mt-4" disabled={dump.isPending} onClick={() => dump.mutate()}>
            {dump.isPending ? "Erzeuge Dump…" : "Datenbank als SQL herunterladen"}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Dateien liegen auf dem Host-Mount und gehören nicht in den SQL-Dump. Wiederherstellen nur manuell per `psql` und
            Kopie des Storage-Ordners.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate font-medium">{v || "—"}</dd>
    </div>
  );
}
