"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  FolderPlus,
  Grid3x3,
  LayoutList,
  Link2,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { FileGlyph } from "@/components/explorer/file-icon";
import { PreviewModal } from "@/components/explorer/preview-modal";
import { UploadQueue, type UploadItem } from "@/components/explorer/upload-queue";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { previewable } from "@/lib/file-kinds";
import { userHasPermission } from "@/lib/permissions";
import type { Breadcrumb, ExplorerEntry, SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type Listing = {
  path: string;
  breadcrumbs: Breadcrumb[];
  scope: string;
  rootLabel: string;
  items: ExplorerEntry[];
};

function triggerDownload(filePath: string) {
  const link = document.createElement("a");
  link.href = `/api/files/download?path=${encodeURIComponent(filePath)}`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === "QUOTA_EXCEEDED") {
      const d = err.details ?? {};
      return `${err.message}\nVerfügbarer Speicher: ${d.availableLabel ?? "—"}\nDateigröße: ${d.fileLabel ?? "—"}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Aktion fehlgeschlagen.";
}

export function FileExplorer({ user, initialPath }: { user: SessionUser; initialPath: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [path, setPath] = useState(initialPath || "/");
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "size" | "modified">("name");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ExplorerEntry } | null>(null);
  const [preview, setPreview] = useState<ExplorerEntry | null>(null);
  const [renameFor, setRenameFor] = useState<ExplorerEntry | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [shareFor, setShareFor] = useState<ExplorerEntry | null>(null);
  const [otdFor, setOtdFor] = useState<ExplorerEntry | null>(null);
  const [clipboard, setClipboard] = useState<{ mode: "copy" | "cut"; paths: string[] } | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const listing = useQuery({
    queryKey: ["files", path],
    queryFn: () => api<Listing>(`/api/files?path=${encodeURIComponent(path)}`),
  });

  const items = useMemo(() => {
    const list = [...(listing.data?.items ?? [])];
    const filtered = query
      ? list.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
      : list;
    filtered.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === "size") return b.size - a.size;
      if (sort === "modified") return b.modifiedAt.localeCompare(a.modifiedAt);
      return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
    });
    return filtered;
  }, [listing.data, query, sort]);

  const mutateRefresh = () => qc.invalidateQueries({ queryKey: ["files"] });

  const del = useMutation({
    mutationFn: (paths: string[]) => api("/api/files", { method: "DELETE", body: JSON.stringify({ paths }) }),
    onSuccess: () => {
      toast.success("In den Papierkorb verschoben");
      mutateRefresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function navigate(next: string) {
    setPath(next);
    setSelected(new Set());
    setMenu(null);
    router.replace(`/files?path=${encodeURIComponent(next)}`, { scroll: false });
  }

  function openEntry(entry: ExplorerEntry) {
    if (entry.isDir) {
      navigate(entry.path);
      return;
    }
    if (entry.editable) {
      router.push(`/files/edit?path=${encodeURIComponent(entry.path)}`);
      return;
    }
    if (previewable(entry.kind)) {
      setPreview(entry);
      return;
    }
    triggerDownload(entry.path);
  }

  function toggleSelect(pathValue: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (next.has(pathValue) && additive) next.delete(pathValue);
      else next.add(pathValue);
      return next;
    });
  }

  async function paste() {
    if (!clipboard) return;
    try {
      for (const from of clipboard.paths) {
        const endpoint = clipboard.mode === "cut" ? "/api/files/move" : "/api/files/copy";
        await api(endpoint, { method: "POST", body: JSON.stringify({ from, to: path }) });
      }
      setClipboard(null);
      mutateRefresh();
      toast.success(clipboard.mode === "cut" ? "Verschoben" : "Kopiert");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], relative = false) => {
      const files = Array.from(fileList);
      for (const file of files) {
        const id = `${Date.now()}-${file.name}-${Math.random()}`;
        setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
        await new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();
          const form = new FormData();
          form.set("path", path);
          const rel = relative ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : "";
          if (rel) form.set("relativePath", rel);
          form.set("file", file);
          xhr.open("POST", `/api/files/upload?path=${encodeURIComponent(path)}`);
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return;
            const progress = Math.round((ev.loaded / ev.total) * 100);
            setUploads((u) => u.map((it) => (it.id === id ? { ...it, progress } : it)));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploads((u) => u.map((it) => (it.id === id ? { ...it, progress: 100 } : it)));
              setTimeout(() => setUploads((u) => u.filter((it) => it.id !== id)), 1500);
              void qc.invalidateQueries({ queryKey: ["files"] });
            } else {
              let msg = "Upload fehlgeschlagen";
              try {
                const parsed = JSON.parse(xhr.responseText) as { error?: string; details?: { availableLabel?: string; fileLabel?: string } };
                msg = parsed.error ?? msg;
                if (parsed.details?.availableLabel) {
                  msg += `\nVerfügbarer Speicher: ${parsed.details.availableLabel}\nDateigröße: ${parsed.details.fileLabel ?? ""}`;
                }
              } catch {
                /* ignore */
              }
              setUploads((u) => u.map((it) => (it.id === id ? { ...it, error: msg } : it)));
              toast.error(msg);
            }
            resolve();
          };
          xhr.onerror = () => {
            setUploads((u) => u.map((it) => (it.id === id ? { ...it, error: "Netzwerkfehler" } : it)));
            resolve();
          };
          xhr.send(form);
        });
      }
    },
    [path, qc],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.path)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        setClipboard({ mode: "copy", paths: [...selected] });
        toast.success("Kopiert");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        setClipboard({ mode: "cut", paths: [...selected] });
        toast.success("Ausschneiden");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") void paste();
      if (e.key === "Delete" && selected.size) {
        if (confirm("Auswahl in den Papierkorb legen?")) del.mutate([...selected]);
      }
      if (e.key === "Enter" && selected.size === 1) {
        const entry = items.find((i) => i.path === [...selected][0]);
        if (entry) openEntry(entry);
      }
      if (e.key === "F2" && selected.size === 1) {
        const entry = items.find((i) => i.path === [...selected][0]);
        if (entry) setRenameFor(entry);
      }
      if (e.key === "Escape") {
        setSelected(new Set());
        setMenu(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="flex h-[calc(100vh-5.5rem)] flex-col"
      onClick={() => setMenu(null)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
          {(listing.data?.breadcrumbs ?? []).map((crumb, idx) => (
            <button
              key={crumb.path}
              type="button"
              className="truncate text-muted-foreground hover:text-primary"
              onClick={() => navigate(crumb.path)}
            >
              {idx > 0 ? <span className="mr-1 text-muted-foreground/50">/</span> : null}
              {crumb.name}
            </button>
          ))}
        </div>
        <Input className="h-9 w-48" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 w-36">
          <option value="name">Name</option>
          <option value="modified">Geändert</option>
          <option value="size">Größe</option>
        </Select>
        <Button variant={view === "list" ? "default" : "outline"} size="icon" onClick={() => setView("list")}>
          <LayoutList className="h-4 w-4" />
        </Button>
        <Button variant={view === "grid" ? "default" : "outline"} size="icon" onClick={() => setView("grid")}>
          <Grid3x3 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={() => listing.refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {userHasPermission(user, "files.upload") ? (
          <>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Dateien
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
              Ordner-Upload
            </Button>
          </>
        ) : null}
        {userHasPermission(user, "folders.create") ? (
          <Button size="sm" variant="outline" onClick={() => setMkdirOpen(true)}>
            <FolderPlus className="h-4 w-4" /> Ordner
          </Button>
        ) : null}
        {selected.size > 0 && userHasPermission(user, "files.delete") ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm("Auswahl in den Papierkorb legen?")) del.mutate([...selected]);
            }}
          >
            <Trash2 className="h-4 w-4" /> Löschen
          </Button>
        ) : null}
      </div>

      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
        onChange={(e) => e.target.files && void uploadFiles(e.target.files, true)}
      />

      <div className={cn("cloudora-panel min-h-0 flex-1 overflow-auto p-2", dragOver && "border-primary")}>
        {listing.isLoading ? <p className="p-6 text-sm text-muted-foreground">Lade Dateien…</p> : null}
        {listing.isError ? <p className="p-6 text-sm text-destructive">{errorMessage(listing.error)}</p> : null}
        {view === "list" ? (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/90 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Größe</th>
                <th className="px-3 py-2">Geändert</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.path}
                  className={cn("cursor-default border-t border-white/5 hover:bg-white/5", selected.has(entry.path) && "bg-primary/10")}
                  onClick={(e) => toggleSelect(entry.path, e.ctrlKey || e.metaKey || e.shiftKey)}
                  onDoubleClick={() => openEntry(entry)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected(new Set([entry.path]));
                    setMenu({ x: e.clientX, y: e.clientY, entry });
                  }}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <FileGlyph kind={entry.kind} className="h-4 w-4 text-primary" />
                      <span className="truncate">{entry.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.isDir ? "—" : formatBytes(entry.size)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDateTime(entry.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {items.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-center hover:border-primary/40 hover:bg-white/5",
                  selected.has(entry.path) && "border-primary/60 bg-primary/10",
                )}
                onClick={(e) => toggleSelect(entry.path, e.ctrlKey || e.metaKey)}
                onDoubleClick={() => openEntry(entry)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(new Set([entry.path]));
                  setMenu({ x: e.clientX, y: e.clientY, entry });
                }}
              >
                <FileGlyph kind={entry.kind} className="h-10 w-10 text-primary" />
                <span className="w-full truncate text-xs">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
        {!listing.isLoading && items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Dieser Ordner ist leer.</p>
        ) : null}
      </div>

      {menu ? (
        <div
          className="cloudora-panel fixed z-50 w-52 p-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={() => openEntry(menu.entry)}>Öffnen</MenuItem>
          {menu.entry.editable ? (
            <MenuItem onClick={() => router.push(`/files/edit?path=${encodeURIComponent(menu.entry.path)}`)}>
              <Pencil className="h-3.5 w-3.5" /> In Formator
            </MenuItem>
          ) : null}
          {userHasPermission(user, "files.download") ? (
            <MenuItem onClick={() => triggerDownload(menu.entry.path)}>
              <Download className="h-3.5 w-3.5" /> Download
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => setRenameFor(menu.entry)}>Umbenennen</MenuItem>
          <MenuItem
            onClick={() => {
              setClipboard({ mode: "copy", paths: [menu.entry.path] });
              toast.success("Kopiert");
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Kopieren
          </MenuItem>
          {userHasPermission(user, "shares.create") ? (
            <MenuItem onClick={() => setShareFor(menu.entry)}>
              <Share2 className="h-3.5 w-3.5" /> Freigeben
            </MenuItem>
          ) : null}
          {userHasPermission(user, "downloads.create") && !menu.entry.isDir ? (
            <MenuItem onClick={() => setOtdFor(menu.entry)}>
              <Link2 className="h-3.5 w-3.5" /> One-Time-Download
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              if (confirm("In den Papierkorb legen?")) del.mutate([menu.entry.path]);
              setMenu(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Löschen
          </MenuItem>
        </div>
      ) : null}

      {preview ? <PreviewModal entry={preview} onClose={() => setPreview(null)} /> : null}
      {mkdirOpen ? (
        <NameDialog
          title="Neuer Ordner"
          onClose={() => setMkdirOpen(false)}
          onSubmit={async (name) => {
            await api("/api/files/mkdir", { method: "POST", body: JSON.stringify({ path, name }) });
            setMkdirOpen(false);
            mutateRefresh();
          }}
        />
      ) : null}
      {renameFor ? (
        <NameDialog
          title="Umbenennen"
          initial={renameFor.name}
          onClose={() => setRenameFor(null)}
          onSubmit={async (name) => {
            await api("/api/files/rename", { method: "POST", body: JSON.stringify({ path: renameFor.path, name }) });
            setRenameFor(null);
            mutateRefresh();
          }}
        />
      ) : null}
      {shareFor ? <ShareDialog entry={shareFor} onClose={() => setShareFor(null)} /> : null}
      {otdFor ? <OtdDialog entry={otdFor} onClose={() => setOtdFor(null)} /> : null}
      <UploadQueue items={uploads} />
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-white/5" onClick={onClick}>
      {children}
    </button>
  );
}

function NameDialog({
  title,
  initial = "",
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <form
        className="cloudora-panel w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          onSubmit(name)
            .catch((err) => toast.error(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        <h3 className="cloudora-title mb-4 text-base">{title}</h3>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            Speichern
          </Button>
        </div>
      </form>
    </div>
  );
}

function ShareDialog({ entry, onClose }: { entry: ExplorerEntry; onClose: () => void }) {
  const [permission, setPermission] = useState("DOWNLOAD");
  const [hours, setHours] = useState("168");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="cloudora-panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="cloudora-title mb-1 text-base">Freigeben</h3>
        <p className="mb-4 text-sm text-muted-foreground">{entry.name}</p>
        {url ? (
          <div>
            <Label>Link</Label>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
        ) : (
          <>
            <Label>Berechtigung</Label>
            <Select value={permission} onChange={(e) => setPermission(e.target.value)}>
              <option value="READ">Nur lesen</option>
              <option value="DOWNLOAD">Lesen & Download</option>
              <option value="EDIT">Bearbeiten</option>
            </Select>
            <div className="mt-3">
              <Label>Ablauf (Stunden, leer = nie)</Label>
              <Input value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="mt-3">
              <Label>Passwort (optional)</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Abbrechen
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const res = await api<{ item: { url: string } }>("/api/shares", {
                      method: "POST",
                      body: JSON.stringify({
                        path: entry.path,
                        permission,
                        password: password || undefined,
                        expiresInHours: hours ? Number(hours) : null,
                      }),
                    });
                    setUrl(res.item.url);
                    toast.success("Freigabe erstellt");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Link erstellen
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OtdDialog({ entry, onClose }: { entry: ExplorerEntry; onClose: () => void }) {
  const [hours, setHours] = useState("24");
  const [max, setMax] = useState("1");
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="cloudora-panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="cloudora-title mb-1 text-base">One-Time Download</h3>
        <p className="mb-4 text-sm text-muted-foreground">{entry.name}</p>
        {url ? (
          <div>
            <Label>Link</Label>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
        ) : (
          <>
            <Label>Ablauf (Stunden)</Label>
            <Input value={hours} onChange={(e) => setHours(e.target.value)} />
            <div className="mt-3">
              <Label>Maximale Downloads</Label>
              <Input value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
            <div className="mt-3">
              <Label>Passwort (optional)</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="mt-3">
              <Label>Beschreibung</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Abbrechen
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const res = await api<{ item: { url: string } }>("/api/downloads", {
                      method: "POST",
                      body: JSON.stringify({
                        path: entry.path,
                        expiresInHours: Number(hours) || 24,
                        maxDownloads: Number(max) || 1,
                        password: password || undefined,
                        description: description || undefined,
                      }),
                    });
                    setUrl(res.item.url);
                    toast.success("One-Time-Download erstellt");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Link erstellen
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
