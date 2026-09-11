"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { LogoLockup } from "@/components/layout/logo-lockup";
import { UiAtmosphere } from "@/components/layout/ui-atmosphere";
import { api, ApiRequestError } from "@/lib/api";
import { kindOf, previewable } from "@/lib/file-kinds";
import { formatBytes } from "@/lib/format";
import { APP_NAME } from "@/lib/version";

type Meta = {
  name: string;
  hasPassword: boolean;
  valid?: boolean;
  isDir?: boolean;
  canDownload?: boolean;
  canEdit?: boolean;
  canPreview?: boolean;
};

type ShareItem = { name: string; isDir: boolean; size: number };

function joinRel(cwd: string, name: string) {
  if (!cwd || cwd === "/") return `/${name}`;
  return `${cwd.replace(/\/$/, "")}/${name}`;
}

function parentRel(cwd: string) {
  if (!cwd || cwd === "/") return "/";
  const parts = cwd.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function folderZipName(cwd: string, shareName?: string) {
  if (!cwd || cwd === "/") return `${shareName || "ordner"}.zip`;
  const parts = cwd.split("/").filter(Boolean);
  return `${parts[parts.length - 1] || shareName || "ordner"}.zip`;
}

export function PublicDownload({ token, kind }: { token: string; kind: "d" | "s" }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cwd, setCwd] = useState("/");
  const [items, setItems] = useState<ShareItem[] | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string; kind: string } | null>(null);
  const meta = useQuery({
    queryKey: ["public", kind, token],
    queryFn: () => api<Meta>(`/api/public/${kind}/${token}`),
  });

  async function postShare(op: "download" | "list" | "preview", relative?: string) {
    const res = await fetch(`/api/public/${kind}/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password || undefined, op, relative }),
    });
    return res;
  }

  async function download(relative = "/", name = meta.data?.name || "download") {
    setBusy(true);
    setError(null);
    try {
      const res = await postShare("download", relative);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Download fehlgeschlagen.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function loadList(relative = cwd) {
    setBusy(true);
    setError(null);
    try {
      const res = await postShare("list", relative);
      const data = (await res.json().catch(() => ({}))) as { error?: string; items?: ShareItem[]; path?: string };
      if (!res.ok) throw new Error(data.error || "Ordner konnte nicht geladen werden.");
      setCwd(data.path || relative);
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ordner konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }

  async function previewFile(relative: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await postShare("preview", relative);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Vorschau fehlgeschlagen.");
      }
      const blob = await res.blob();
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ name, url: URL.createObjectURL(blob), kind: kindOf(name, false) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vorschau fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("password", password);
      fd.append("relative", cwd);
      fd.append("file", file);
      const res = await fetch(`/api/public/s/${token}/upload`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Upload fehlgeschlagen.");
      if (meta.data?.isDir) await loadList(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const shareReady = kind === "s" && (items !== null || meta.data?.isDir === false);

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <UiAtmosphere />
      <Card className="relative z-10 w-full max-w-lg">
        <LogoLockup />
        <h1 className="cloudora-title mt-6 text-xl">{kind === "s" ? "Freigabe" : "Download"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.data?.name || APP_NAME}</p>
        {meta.data?.hasPassword ? (
          <div className="mt-4">
            <Label>Passwort</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        ) : null}
        {error || meta.error ? (
          <p className="mt-3 text-sm text-destructive">
            {error || (meta.error instanceof ApiRequestError ? meta.error.message : "Dieser Link ist ungültig oder abgelaufen.")}
          </p>
        ) : null}

        {kind === "d" || !shareReady ? (
          <div className="mt-5 flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={busy || !meta.data}
              onClick={() => {
                if (kind === "s" && meta.data?.isDir) void loadList("/");
                else void download("/", meta.data?.name || "download");
              }}
            >
              {busy ? "Lade…" : kind === "s" && meta.data?.isDir ? "Öffnen" : "Herunterladen"}
            </Button>
            {kind === "s" && meta.data?.isDir && meta.data.canDownload ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => void download("/", folderZipName("/", meta.data?.name))}
              >
                Als ZIP herunterladen
              </Button>
            ) : null}
          </div>
        ) : null}

        {kind === "s" && shareReady && meta.data?.isDir === false ? (
          <div className="mt-5 flex flex-col gap-2">
            {meta.data.canDownload ? (
              <Button disabled={busy} onClick={() => void download("/", meta.data?.name || "download")}>
                Herunterladen
              </Button>
            ) : null}
            {meta.data.canPreview && previewable(kindOf(meta.data.name, false)) ? (
              <Button variant="outline" disabled={busy} onClick={() => void previewFile("/", meta.data!.name)}>
                Vorschau
              </Button>
            ) : null}
            {meta.data.canEdit ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Datei ersetzen</span>
                <Input type="file" disabled={busy} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                }} />
              </label>
            ) : null}
          </div>
        ) : null}

        {kind === "s" && items ? (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">{cwd}</span>
              <div className="flex shrink-0 items-center gap-1">
                {meta.data?.canDownload ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void download(cwd, folderZipName(cwd, meta.data?.name))}>
                    Als ZIP
                  </Button>
                ) : null}
                {cwd !== "/" ? (
                  <Button size="sm" variant="ghost" onClick={() => void loadList(parentRel(cwd))}>
                    Zurück
                  </Button>
                ) : null}
              </div>
            </div>
            <ul className="max-h-72 divide-y divide-white/5 overflow-auto rounded-lg border border-border">
              {items.map((item) => {
                const relative = joinRel(cwd, item.name);
                return (
                  <li key={relative} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left hover:text-primary"
                      onClick={() => {
                        if (item.isDir) void loadList(relative);
                        else if (meta.data?.canPreview && previewable(kindOf(item.name, false))) void previewFile(relative, item.name);
                      }}
                    >
                      {item.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.isDir ? "Ordner" : formatBytes(item.size)}
                      </span>
                    </button>
                    {item.isDir && meta.data?.canDownload ? (
                      <Button size="sm" variant="outline" onClick={() => void download(relative, `${item.name}.zip`)}>
                        ZIP
                      </Button>
                    ) : null}
                    {!item.isDir && meta.data?.canDownload ? (
                      <Button size="sm" variant="outline" onClick={() => void download(relative, item.name)}>
                        Download
                      </Button>
                    ) : null}
                  </li>
                );
              })}
              {items.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">Leer</li> : null}
            </ul>
            {meta.data?.canEdit ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Datei hochladen</span>
                <Input type="file" disabled={busy} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                }} />
              </label>
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <div className="mt-5 space-y-2">
            <p className="text-sm font-medium">{preview.name}</p>
            {preview.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.name} className="max-h-64 w-full rounded-lg object-contain" />
            ) : preview.kind === "video" ? (
              <video src={preview.url} controls className="w-full rounded-lg" />
            ) : preview.kind === "audio" ? (
              <audio src={preview.url} controls className="w-full" />
            ) : preview.kind === "pdf" ? (
              <iframe title={preview.name} src={preview.url} className="h-64 w-full rounded-lg bg-white" />
            ) : (
              <p className="text-xs text-muted-foreground">Vorschau geladen. Download über den jeweiligen Button.</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(preview.url);
                setPreview(null);
              }}
            >
              Vorschau schließen
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
