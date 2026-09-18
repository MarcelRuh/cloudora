"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Copy,
  Download,
  FolderPlus,
  Grid3x3,
  HardDrive,
  LayoutList,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { SegmentTabs } from "@/components/ui/tabs";
import { FileGlyph } from "@/components/explorer/file-icon";
import { PreviewModal } from "@/components/explorer/preview-modal";
import { useTransfers } from "@/components/transfers/transfer-provider";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { previewable } from "@/lib/file-kinds";
import { shouldRetryUpload, UPLOAD_MAX_ATTEMPTS, uploadRetryDelayMs } from "@/lib/upload";
import { isAdministrator, userHasPermission } from "@/lib/permissions";
import { downloadErrorMessage, isAbortError, shouldOfferSavePicker } from "@/lib/download";
import { downloadGetWithProgress, requestSaveHandle } from "@/lib/download-browser";
import { createSpeedTracker, newTransferId, transferProgress } from "@/lib/transfer";
import type { Breadcrumb, ExplorerEntry, SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type Listing = {
  path: string;
  parentPath?: string | null;
  breadcrumbs: Breadcrumb[];
  scope: string;
  rootLabel: string;
  catalog?: boolean;
  writable?: boolean;
  mount?: { label: string; name?: string; kind?: "home" | "share"; hostPath?: string };
  items: ExplorerEntry[];
};

function entryLabel(entry: ExplorerEntry): string {
  return entry.displayName || entry.name;
}

function isProtectedRoot(entry?: ExplorerEntry | null): boolean {
  return Boolean(entry?.mount);
}

function MountBadge({
  mount,
  isAdmin,
}: {
  mount?: { label: string; name?: string; kind?: "home" | "share"; hostPath?: string };
  isAdmin: boolean;
}) {
  if (!mount) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
      <HardDrive className="h-3 w-3 shrink-0" />
      <span className="truncate">{isAdmin && mount.hostPath ? mount.hostPath : mount.label}</span>
    </span>
  );
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

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function FileExplorer({ user, initialPath }: { user: SessionUser; initialPath: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = isAdministrator(user);
  const start = initialPath || "/";
  const [path, setPath] = useState(start);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<"name" | "size" | "modified">("name");
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ExplorerEntry } | null>(null);
  const [preview, setPreview] = useState<ExplorerEntry | null>(null);
  const [renameFor, setRenameFor] = useState<ExplorerEntry | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [shareFor, setShareFor] = useState<ExplorerEntry | null>(null);
  const [clipboard, setClipboard] = useState<{ mode: "copy" | "cut"; paths: string[] } | null>(null);
  const { add: addTransfer, patch: patchTransfer, finish: finishTransfer } = useTransfers();
  const [dragOver, setDragOver] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const historyRef = useRef<string[]>([start]);
  const histIndexRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchDebounced = useDebounced(query.trim(), 220);

  const listing = useQuery({
    queryKey: ["files", path],
    queryFn: () => api<Listing>(`/api/files?path=${encodeURIComponent(path)}`),
  });

  const remoteSearch = useQuery({
    queryKey: ["search", searchDebounced],
    queryFn: () => api<{ items: ExplorerEntry[] }>(`/api/search?q=${encodeURIComponent(searchDebounced)}`),
    enabled: searchOpen && searchDebounced.length >= 2,
  });

  const items = useMemo(() => {
    const list = [...(listing.data?.items ?? [])];
    const filtered = query
      ? list.filter((i) => {
          const hay = `${i.name} ${i.displayName ?? ""}`.toLowerCase();
          const extra = isAdmin ? (i.mount?.hostPath ?? "") : "";
          return `${hay} ${extra}`.toLowerCase().includes(query.toLowerCase());
        })
      : list;
    filtered.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort === "size") return b.size - a.size;
      if (sort === "modified") return b.modifiedAt.localeCompare(a.modifiedAt);
      return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
    });
    return filtered;
  }, [listing.data, query, sort, isAdmin]);

  const selectedEntries = useMemo(
    () => items.filter((entry) => selected.has(entry.path)),
    [items, selected],
  );
  const single = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const writable = listing.data?.writable !== false && listing.data?.catalog !== true;
  const hasLocked = selectedEntries.some((entry) => isProtectedRoot(entry));
  const canUpload = writable && userHasPermission(user, "files.upload");
  const canMkdir = writable && userHasPermission(user, "folders.create");
  const canRename = Boolean(single) && !isProtectedRoot(single) && userHasPermission(user, "files.rename");
  const canDelete =
    selectedEntries.length > 0 && !hasLocked && userHasPermission(user, "files.delete");
  const canCopy = selectedEntries.length > 0 && !hasLocked && userHasPermission(user, "files.copy");
  const canCut = canCopy && writable && userHasPermission(user, "files.move");
  const canPaste = Boolean(clipboard) && writable;
  const canDownload = selectedEntries.length > 0 && userHasPermission(user, "files.download");
  const canShare = Boolean(single) && userHasPermission(user, "shares.create");
  const canOtd = Boolean(single && !single.isDir && userHasPermission(user, "downloads.create"));
  const canLink = canShare || canOtd;
  const canUp = listing.data?.parentPath != null;

  const mutateRefresh = () => qc.invalidateQueries({ queryKey: ["files"] });

  const del = useMutation({
    mutationFn: (paths: string[]) => api("/api/files", { method: "DELETE", body: JSON.stringify({ paths }) }),
    onSuccess: () => {
      toast.success("In den Papierkorb verschoben");
      setSelected(new Set());
      mutateRefresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function syncHistoryButtons() {
    setCanBack(histIndexRef.current > 0);
    setCanForward(histIndexRef.current < historyRef.current.length - 1);
  }

  function navigate(next: string, mode: "push" | "goto" = "push") {
    if (mode === "push") {
      const trimmed = historyRef.current.slice(0, histIndexRef.current + 1);
      if (trimmed[trimmed.length - 1] !== next) trimmed.push(next);
      historyRef.current = trimmed;
      histIndexRef.current = trimmed.length - 1;
    }
    setPath(next);
    setSelected(new Set());
    setMenu(null);
    setSearchOpen(false);
    syncHistoryButtons();
    router.replace(`/files?path=${encodeURIComponent(next)}`, { scroll: false });
  }

  function goBack() {
    if (histIndexRef.current <= 0) return;
    histIndexRef.current -= 1;
    navigate(historyRef.current[histIndexRef.current], "goto");
  }

  function goForward() {
    if (histIndexRef.current >= historyRef.current.length - 1) return;
    histIndexRef.current += 1;
    navigate(historyRef.current[histIndexRef.current], "goto");
  }

  function goUp() {
    const parent = listing.data?.parentPath;
    if (parent == null) return;
    navigate(parent);
  }

  async function startDownload(virtualPath: string, displayName: string, isDir = false, knownSize?: number) {
    const fallbackName = isDir ? `${displayName}.zip` : displayName;
    const url = `/api/files/download?path=${encodeURIComponent(virtualPath)}`;
    const size = !isDir && knownSize && knownSize > 0 ? knownSize : null;
    let handle = null;
    if (shouldOfferSavePicker(isDir, size)) {
      try {
        handle = await requestSaveHandle(fallbackName);
      } catch (err) {
        if (isAbortError(err)) return;
      }
    }

    const id = newTransferId();
    const speedOf = createSpeedTracker();
    addTransfer({ id, name: fallbackName, kind: "download", loaded: 0, total: size, progress: 0, speedBps: 0 });
    try {
      const result = await downloadGetWithProgress({
        url,
        filename: fallbackName,
        knownSize: size,
        isArchive: isDir,
        handle,
        onProgress: (loaded, total) => {
          patchTransfer(id, {
            loaded,
            total,
            progress: transferProgress(loaded, total),
            speedBps: speedOf(loaded),
          });
        },
      });
      finishTransfer(id, {
        name: result.filename,
        loaded: result.loaded,
        total: result.total,
        progress: 100,
        speedBps: 0,
        done: true,
      });
      if (result.mode === "browser") toast.success("Download im Browser gestartet");
    } catch (err) {
      const msg = downloadErrorMessage(err);
      finishTransfer(id, { error: msg, speedBps: 0 });
      if (!isAbortError(err)) toast.error(msg);
    }
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
    void startDownload(entry.path, entryLabel(entry), false, entry.size);
  }

  function toggleSelect(pathValue: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (next.has(pathValue) && additive) next.delete(pathValue);
      else next.add(pathValue);
      return next;
    });
  }

  function copySelection(mode: "copy" | "cut") {
    if (mode === "copy" && !canCopy) return;
    if (mode === "cut" && !canCut) return;
    setClipboard({ mode, paths: [...selected] });
    toast.success(mode === "cut" ? "Ausgeschnitten" : "Kopiert");
  }

  async function paste() {
    if (!clipboard || !canPaste) return;
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

  function confirmDelete(paths: string[]) {
    if (!paths.length) return;
    if (confirm("Auswahl in den Papierkorb legen?")) del.mutate(paths);
  }

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], relative = false) => {
      const files = Array.from(fileList);
      for (const file of files) {
        const id = newTransferId();
        const speedOf = createSpeedTracker();
        addTransfer({
          id,
          name: file.name,
          kind: "upload",
          loaded: 0,
          total: file.size || null,
          progress: 0,
          speedBps: 0,
        });
        for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
          const retry = await new Promise<"ok" | "retry" | "fail">((resolve) => {
            const xhr = new XMLHttpRequest();
            const form = new FormData();
            form.set("path", path);
            const rel = relative ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : "";
            if (rel) form.set("relativePath", rel);
            form.set("file", file);
            xhr.open("POST", `/api/files/upload?path=${encodeURIComponent(path)}`);
            xhr.upload.onprogress = (ev) => {
              const total = ev.lengthComputable ? ev.total : file.size || null;
              patchTransfer(id, {
                loaded: ev.loaded,
                total,
                progress: transferProgress(ev.loaded, total),
                speedBps: speedOf(ev.loaded),
              });
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                finishTransfer(id, { progress: 100, speedBps: 0, done: true });
                void qc.invalidateQueries({ queryKey: ["files"] });
                resolve("ok");
                return;
              }
              if (shouldRetryUpload(xhr.status) && attempt < UPLOAD_MAX_ATTEMPTS - 1) {
                resolve("retry");
                return;
              }
              let msg = "Upload fehlgeschlagen";
              try {
                const parsed = JSON.parse(xhr.responseText) as {
                  error?: string;
                  details?: { availableLabel?: string; fileLabel?: string };
                };
                msg = parsed.error ?? msg;
                if (parsed.details?.availableLabel) {
                  msg += `\nVerfügbarer Speicher: ${parsed.details.availableLabel}\nDateigröße: ${parsed.details.fileLabel ?? ""}`;
                }
              } catch {
                /* ignore */
              }
              patchTransfer(id, { error: msg, speedBps: 0 });
              toast.error(msg);
              resolve("fail");
            };
            xhr.onerror = () => {
              if (attempt < UPLOAD_MAX_ATTEMPTS - 1 && shouldRetryUpload(0)) {
                resolve("retry");
                return;
              }
              patchTransfer(id, { error: "Netzwerkfehler", speedBps: 0 });
              resolve("fail");
            };
            xhr.send(form);
          });
          if (retry === "ok" || retry === "fail") break;
          await new Promise((r) => window.setTimeout(r, uploadRetryDelayMs(attempt)));
        }
      }
    },
    [path, qc, addTransfer, patchTransfer, finishTransfer],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        goUp();
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        goUp();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.path)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") copySelection("copy");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") copySelection("cut");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") void paste();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        searchWrapRef.current?.querySelector("input")?.focus();
      }
      if (e.key === "Delete" && canDelete) confirmDelete([...selected]);
      if (e.key === "Enter" && selected.size === 1) {
        const entry = items.find((i) => i.path === [...selected][0]);
        if (entry) openEntry(entry);
      }
      if (e.key === "F2" && canRename && single) setRenameFor(single);
      if (e.key === "Escape") {
        setSelected(new Set());
        setMenu(null);
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const searchHits = remoteSearch.data?.items ?? [];

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
        if (!canUpload) return;
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" disabled={!canBack} title="Zurück" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={!canForward} title="Vor" onClick={goForward}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={!canUp} title="Ordner zurück" onClick={goUp}>
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[var(--ui-radius)] border border-border bg-white/[0.03] px-3 py-1.5 text-sm">
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
        <div ref={searchWrapRef} className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Suchen"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && searchDebounced.length >= 2 ? (
            <div className="cloudora-panel absolute right-0 z-40 mt-1 w-[min(24rem,calc(100vw-2rem))] p-1">
              {remoteSearch.isFetching ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Suche…</p>
              ) : null}
              {searchHits.map((hit) => (
                <button
                  key={hit.path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                    if (hit.isDir) navigate(hit.path);
                    else openEntry(hit);
                  }}
                >
                  <FileGlyph kind={hit.kind} className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate">{entryLabel(hit)}</span>
                  {isAdmin && hit.mount?.hostPath ? (
                    <span className="ml-auto max-w-[40%] truncate font-mono text-[10px] text-muted-foreground">
                      {hit.mount.hostPath}
                    </span>
                  ) : null}
                </button>
              ))}
              {!remoteSearch.isFetching && searchHits.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Keine Treffer in allen Ordnern.</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 w-36">
          <option value="name">Name</option>
          <option value="modified">Geändert</option>
          <option value="size">Größe</option>
        </Select>
        <Button variant={view === "list" ? "default" : "outline"} size="icon" title="Liste" onClick={() => setView("list")}>
          <LayoutList className="h-4 w-4" />
        </Button>
        <Button variant={view === "grid" ? "default" : "outline"} size="icon" title="Kacheln" onClick={() => setView("grid")}>
          <Grid3x3 className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title="Aktualisieren" onClick={() => listing.refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {listing.data?.mount ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <HardDrive className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-medium text-primary">{listing.data.mount.name || listing.data.mount.label}</p>
            {isAdmin && listing.data.mount.hostPath ? (
              <p className="truncate font-mono text-xs text-muted-foreground">{listing.data.mount.hostPath}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {listing.data.mount.kind === "home" ? "Persönlicher Ordner" : "Zugewiesener Ordner"}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={!canUpload} title={canUpload ? "Dateien hochladen" : "Hier nicht möglich"} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> Dateien
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canUpload}
          title={canUpload ? "Ordner hochladen" : "Hier nicht möglich"}
          onClick={() => folderRef.current?.click()}
        >
          Ordner-Upload
        </Button>
        <Button size="sm" variant="outline" disabled={!canMkdir} title={canMkdir ? "Neuer Ordner" : "Hier nicht möglich"} onClick={() => setMkdirOpen(true)}>
          <FolderPlus className="h-4 w-4" /> Ordner
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRename}
          title={canRename ? "Umbenennen" : hasLocked ? "Home und zugewiesene Ordner können nicht umbenannt werden" : "Eintrag wählen"}
          onClick={() => single && setRenameFor(single)}
        >
          <Pencil className="h-4 w-4" /> Umbenennen
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canCopy}
          title={canCopy ? "Kopieren" : "Eintrag wählen"}
          onClick={() => copySelection("copy")}
        >
          <Copy className="h-4 w-4" /> Kopieren
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canCut}
          title={canCut ? "Ausschneiden" : "Eintrag wählen"}
          onClick={() => copySelection("cut")}
        >
          <Scissors className="h-4 w-4" /> Ausschneiden
        </Button>
        <Button size="sm" variant="outline" disabled={!canPaste} title={canPaste ? "Einfügen" : "Zwischenablage leer"} onClick={() => void paste()}>
          <ClipboardPaste className="h-4 w-4" /> Einfügen
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canDownload}
          title={canDownload ? "Download" : "Eintrag wählen"}
          onClick={() =>
            void (async () => {
              for (const entry of selectedEntries) {
                await startDownload(entry.path, entryLabel(entry), entry.isDir, entry.size);
              }
            })()
          }
        >
          <Download className="h-4 w-4" /> Download
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canLink}
          title={canLink ? "Öffentlichen oder Einmal-Link erstellen" : "Datei oder Ordner wählen"}
          onClick={() => single && setShareFor(single)}
        >
          <Share2 className="h-4 w-4" /> Teilen
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!canDelete}
          title={
            canDelete
              ? "Löschen"
              : hasLocked
                ? "Home und zugewiesene Ordner können nicht gelöscht werden — nur der Inhalt"
                : "Eintrag wählen"
          }
          onClick={() => confirmDelete([...selected])}
        >
          <Trash2 className="h-4 w-4" /> Löschen
        </Button>
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
                    <span className="flex min-w-0 items-center gap-2">
                      <FileGlyph kind={entry.kind} mount={Boolean(entry.mount)} className="h-4 w-4 shrink-0 text-primary" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entryLabel(entry)}</span>
                        {entry.mount ? <MountBadge mount={entry.mount} isAdmin={isAdmin} /> : null}
                      </span>
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
                <FileGlyph kind={entry.kind} mount={Boolean(entry.mount)} className="h-10 w-10 text-primary" />
                <span className="w-full truncate text-xs">{entryLabel(entry)}</span>
                {entry.mount ? <MountBadge mount={entry.mount} isAdmin={isAdmin} /> : null}
              </button>
            ))}
          </div>
        )}
        {!listing.isLoading && items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {listing.data?.catalog
              ? userHasPermission(user, "storage.global")
                ? "Keine zugewiesenen Ordner. Unter Administration → Speicher kannst du Ordnerzugriff anlegen."
                : "Keine Ordner. Ein Administrator muss dir unter Speicher einen Ordner zuweisen."
              : query
                ? "Keine Treffer in diesem Ordner."
                : "Dieser Ordner ist leer."}
          </p>
        ) : null}
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem
            onClick={() => {
              openEntry(menu.entry);
              setMenu(null);
            }}
          >
            Öffnen
          </MenuItem>
          {!menu.entry.isDir && menu.entry.editable ? (
            <MenuItem
              onClick={() => {
                setMenu(null);
                router.push(`/files/edit?path=${encodeURIComponent(menu.entry.path)}`);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> In Formator
            </MenuItem>
          ) : null}
          <MenuItem
            disabled={!userHasPermission(user, "files.download")}
            onClick={() => {
              setMenu(null);
              void startDownload(menu.entry.path, entryLabel(menu.entry), menu.entry.isDir, menu.entry.size);
            }}
          >
            <Download className="h-3.5 w-3.5" /> {menu.entry.isDir ? "Als ZIP" : "Download"}
          </MenuItem>
          {!isProtectedRoot(menu.entry) ? (
            <MenuItem
              disabled={!userHasPermission(user, "files.rename")}
              onClick={() => {
                setMenu(null);
                setRenameFor(menu.entry);
              }}
            >
              Umbenennen
            </MenuItem>
          ) : null}
          {!isProtectedRoot(menu.entry) ? (
            <MenuItem
              onClick={() => {
                setClipboard({ mode: "copy", paths: [menu.entry.path] });
                setMenu(null);
                toast.success("Kopiert");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Kopieren
            </MenuItem>
          ) : null}
          <MenuItem
            disabled={
              !userHasPermission(user, "shares.create") &&
              (!userHasPermission(user, "downloads.create") || menu.entry.isDir)
            }
            onClick={() => {
              setMenu(null);
              setShareFor(menu.entry);
            }}
          >
            <Share2 className="h-3.5 w-3.5" /> Teilen
          </MenuItem>
          {!isProtectedRoot(menu.entry) ? (
            <MenuItem
              disabled={!userHasPermission(user, "files.delete")}
              onClick={() => {
                confirmDelete([menu.entry.path]);
                setMenu(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Löschen
            </MenuItem>
          ) : null}
        </ContextMenu>
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
      {shareFor ? (
        <ShareDialog
          entry={shareFor}
          canPublic={userHasPermission(user, "shares.create")}
          canOnce={userHasPermission(user, "downloads.create")}
          onClose={() => setShareFor(null)}
        />
      ) : null}
    </div>
  );
}

function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDoc(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="cloudora-panel fixed z-[80] w-52 p-1 text-sm shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
    >
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

function ShareDialog({
  entry,
  canPublic,
  canOnce,
  onClose,
}: {
  entry: ExplorerEntry;
  canPublic: boolean;
  canOnce: boolean;
  onClose: () => void;
}) {
  const onceOk = canOnce && !entry.isDir;
  const onceHint = !canOnce
    ? "Dein Konto darf keine Einmal-Links erstellen (Benutzer → Rechte)."
    : entry.isDir
      ? "Einmal-Links gelten nur für eine Datei — nicht für Ordner. Datei wählen, dann Teilen."
      : "Begrenzte Downloads. Nach Ablauf oder Limit ungültig.";
  const [kind, setKind] = useState<"public" | "once">(canPublic ? "public" : "once");
  const [permission, setPermission] = useState("DOWNLOAD");
  const [hours, setHours] = useState(canPublic ? "168" : "24");
  const [max, setMax] = useState("1");
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchKind(next: "public" | "once") {
    setKind(next);
    setUrl(null);
    setHours(next === "public" ? "168" : "24");
  }

  async function create() {
    setBusy(true);
    try {
      if (kind === "public") {
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
      } else {
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
      }
      toast.success("Link erstellt");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="cloudora-panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="cloudora-title mb-1 text-base">Teilen</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          URL für {entryLabel(entry)}. Kein Explorer-Zugriff — nur dieser Link.
        </p>
        {canPublic || canOnce ? (
          <SegmentTabs
            className="mb-4"
            value={kind}
            onChange={switchKind}
            tabs={[
              { id: "public", label: "Öffentlich", disabled: !canPublic },
              { id: "once", label: "Einmal", disabled: !canOnce },
            ]}
          />
        ) : null}
        <p className="mb-4 text-xs text-muted-foreground">
          {kind === "public"
            ? "Mehrfach nutzbar, für Datei oder Ordner. Optional Passwort und Ablauf."
            : onceHint}
        </p>
        {url ? (
          <div>
            <Label>Link</Label>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          </div>
        ) : (
          <>
            {kind === "public" ? (
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
              </>
            ) : (
              <>
                <Label>Ablauf (Stunden)</Label>
                <Input value={hours} onChange={(e) => setHours(e.target.value)} disabled={!onceOk} />
                <div className="mt-3">
                  <Label>Maximale Downloads</Label>
                  <Input value={max} onChange={(e) => setMax(e.target.value)} disabled={!onceOk} />
                </div>
                <div className="mt-3">
                  <Label>Beschreibung</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!onceOk} />
                </div>
              </>
            )}
            <div className="mt-3">
              <Label>Passwort (optional)</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} disabled={kind === "once" && !onceOk} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Abbrechen
              </Button>
              <Button onClick={() => void create()} disabled={busy || (kind === "once" && !onceOk)}>
                {busy ? "…" : "Link erstellen"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
