"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExtraVolumesEditor, type ExtraVolume } from "@/components/admin/extra-volumes-editor";
import { PathPickerField } from "@/components/admin/path-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentTabs } from "@/components/ui/tabs";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

type PathStatus = {
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
  hostBrowse?: boolean;
  linked?: boolean;
  live?: boolean;
};
type StorageTab = "overview" | "paths" | "volumes" | "homes";

type Storage = {
  usedBytes: number;
  storagePath: string;
  hostStorage: string;
  usersDir: string;
  sharedDir: string;
  extraVolumes: ExtraVolume[];
  storageStatus: PathStatus;
  usersDirStatus: PathStatus;
  sharedDirStatus: PathStatus;
  users: Array<{
    id: string;
    username: string;
    displayName: string;
    homePath: string;
    homePathEnabled: boolean;
    usedBytes: number;
    quotaBytes: number | null;
  }>;
};

export default function StoragePage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-storage"], queryFn: () => api<Storage>("/api/admin/storage") });
  const [tab, setTab] = useState<StorageTab>("paths");
  const [storagePath, setStoragePath] = useState("");
  const [usersDir, setUsersDir] = useState("");
  const [sharedDir, setSharedDir] = useState("");

  useEffect(() => {
    if (!data) return;
    setStoragePath(data.storagePath);
    setUsersDir(data.usersDir);
    setSharedDir(data.sharedDir);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<{ apply?: { mode: string; message: string } }>("/api/admin/storage", {
        method: "PATCH",
        body: JSON.stringify({ storagePath, usersDir, sharedDir }),
      }),
    onSuccess: (res) => {
      toast.success(res.apply?.message || "Pfade gespeichert");
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
      qc.invalidateQueries({ queryKey: ["linux-inspect"] });
      qc.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Administration</p>
        <h1 className="cloudora-title mt-1 text-3xl md:text-4xl">Speicher</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Der Compose-Bind (`CLOUDORA_HOST_STORAGE`, z. B. ein Proxmox-Mount) ist `/storage`. Extra-Volumes nur für weitere Host-Ordner außerhalb davon.
        </p>
      </div>

      <SegmentTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Übersicht" },
          { id: "paths", label: "Standard-Pfade" },
          { id: "volumes", label: "Volumes" },
          { id: "homes", label: "Benutzer-Homes" },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <p className="text-sm text-muted-foreground">Gesamtbelegung</p>
            <p className="cloudora-stat mt-2 text-3xl">{data ? formatBytes(data.usedBytes) : "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Host-Bind: {data?.hostStorage || "—"} → {data?.storagePath || "—"}
            </p>
          </Card>
          <Card className="space-y-2">
            <p className="cloudora-section">Aktuelle Pfade</p>
            <StatusRow label="Storage-Root" value={data?.storagePath} status={data?.storageStatus} />
            <StatusRow label="Benutzer-Ordner" value={data?.usersDir} status={data?.usersDirStatus} />
            <StatusRow label="Shared-Ordner" value={data?.sharedDir} status={data?.sharedDirStatus} />
            <p className="pt-2 text-xs text-muted-foreground">
              Extra-Volumes: {data?.extraVolumes?.length ?? 0}
            </p>
          </Card>
        </div>
      ) : null}

      {tab === "paths" ? (
        <Card>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Dateien liegen auf dem Docker-Volume (hier: Host-Pfad aus CLOUDORA_HOST_STORAGE). Unterordner relativ speichern (users, shared). Andere Host-Ordner werden nur gelinkt, wenn sie außerhalb dieses Volumes liegen.
            </p>
            <PathPickerField
              label="Storage-Root"
              value={storagePath}
              onChange={setStoragePath}
              storageRoot={storagePath}
              placeholder="/storage"
              hint="Absoluter Linux-Pfad im Container. Muss dem Docker-Volume entsprechen."
            />
            <PathPickerField
              label="Benutzer-Ordner"
              value={usersDir}
              onChange={setUsersDir}
              storageRoot={storagePath}
              preferRelative
              volumeRootRelative="users"
              placeholder="users oder /home"
              hint="Relativ zum Storage-Root (users). Der Host-Bind (CLOUDORA_HOST_STORAGE) ist bereits das Volume."
            />
            <PathPickerField
              label="Shared-Ordner"
              value={sharedDir}
              onChange={setSharedDir}
              storageRoot={storagePath}
              preferRelative
              volumeRootRelative="shared"
              placeholder="shared"
              hint="Relativ zum Storage-Root (shared). Derselbe Host-Ordner wie das Volume nicht extra linken."
            />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "…" : "Pfade speichern"}
            </Button>
          </form>
        </Card>
      ) : null}

      {tab === "volumes" ? (
        <ExtraVolumesEditor volumes={data?.extraVolumes ?? []} storagePath={data?.storagePath || "/storage"} />
      ) : null}

      {tab === "homes" ? (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">Homes werden unter Benutzer bearbeitet.</p>
            <Link href="/admin/users" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Benutzer verwalten
            </Link>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Benutzer</th>
                <th className="px-4 py-3">Home</th>
                <th className="px-4 py-3">Verbrauch</th>
                <th className="px-4 py-3">Quota</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-3">{u.displayName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.homePathEnabled ? u.homePath : "aus"}</td>
                  <td className="px-4 py-3">{formatBytes(u.usedBytes)}</td>
                  <td className="px-4 py-3">{u.quotaBytes == null ? "unbegrenzt" : formatBytes(u.quotaBytes)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/users?id=${encodeURIComponent(u.id)}&tab=storage`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Bearbeiten
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

function StatusRow({ label, value, status }: { label: string; value?: string; status?: PathStatus }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-xs">{value || "—"}</p>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status?: PathStatus }) {
  if (!status) return null;
  if (status.linked && status.live && status.writable) {
    return <p className="text-xs text-success">Vorhanden und beschreibbar</p>;
  }
  if (status.linked && !status.live) {
    return <p className="text-xs text-warning">Volume eingetragen — Bind-Mount ausstehend.</p>;
  }
  if (status.hostBrowse && status.exists) {
    return <p className="text-xs text-warning">Auf dem Host vorhanden — beim Speichern als Volume linken.</p>;
  }
  if (!status.exists) return <p className="text-xs text-warning">Pfad existiert noch nicht — wird beim Speichern angelegt, falls berechtigt.</p>;
  if (!status.isDirectory) return <p className="text-xs text-destructive">Kein Verzeichnis</p>;
  if (!status.writable) return <p className="text-xs text-warning">Nicht beschreibbar</p>;
  return <p className="text-xs text-success">Vorhanden und beschreibbar</p>;
}
