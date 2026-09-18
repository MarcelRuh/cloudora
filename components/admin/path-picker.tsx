"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderOpen, HardDrive, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentTabs } from "@/components/ui/tabs";
import { api, ApiRequestError } from "@/lib/api";
import { toConfiguredFromAbsolute } from "@/lib/posix-path";
import { cn } from "@/lib/utils";

type Browse = {
  path: string;
  parent: string | null;
  writable: boolean;
  truncated: boolean;
  insideVolume: boolean;
  storagePath?: string;
  hostStorage?: string;
  entries: Array<{ name: string; path: string; readable: boolean }>;
  shortcuts: Array<{ name: string; path: string; readable: boolean }>;
};

type Inspect = {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  writable: boolean;
  insideVolume: boolean;
  configured: string;
  hostStorage?: string;
  hostBrowse?: boolean;
  linked?: boolean;
  live?: boolean;
  volumeId?: string | null;
};

type LocationTab = "linux" | "home" | "mounts" | "media" | "storage";

const LOCATION_TABS: Array<{ id: LocationTab; label: string; path: string }> = [
  { id: "linux", label: "Linux /", path: "/" },
  { id: "home", label: "Home", path: "/home" },
  { id: "mounts", label: "Mounts", path: "/mnt" },
  { id: "media", label: "Media", path: "/media" },
  { id: "storage", label: "Storage", path: "/storage" },
];

function breadcrumbs(absPath: string): Array<{ label: string; path: string }> {
  if (!absPath || absPath === "/") return [{ label: "/", path: "/" }];
  const parts = absPath.split("/").filter(Boolean);
  const items = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    items.push({ label: part, path: acc });
  }
  return items;
}

function joinUnderRoot(root: string, relative: string): string {
  const base = root.replace(/\/+$/, "") || "/";
  const rest = relative.replace(/^\/+/, "");
  if (!rest) return base;
  return `${base}/${rest}`;
}

function tabForPath(absPath: string, storageRoot: string): LocationTab {
  if (absPath === "/") return "linux";
  const roots: Array<{ id: LocationTab; path: string }> = [
    { id: "storage", path: storageRoot },
    { id: "home", path: "/home" },
    { id: "mounts", path: "/mnt" },
    { id: "media", path: "/media" },
  ];
  const match = roots
    .filter((root) => root.path && root.path !== "/" && (absPath === root.path || absPath.startsWith(`${root.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.id ?? "linux";
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function PathLiveStatus({ value }: { value: string }) {
  const debounced = useDebounced(value.trim(), 280);
  const { data, error, isFetching } = useQuery({
    queryKey: ["linux-inspect", debounced],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("dir", debounced);
      return api<Inspect>(`/api/admin/storage/inspect?${params.toString()}`);
    },
    enabled: debounced.length > 0,
  });

  if (!debounced) return null;
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {error instanceof ApiRequestError ? error.message : "Pfad konnte nicht geprüft werden."}
      </p>
    );
  }
  if (!data) {
    return <p className="text-xs text-muted-foreground">{isFetching ? "Prüfe Pfad…" : null}</p>;
  }

  const status = liveStatusText(data);
  const statusClass = liveStatusClass(data);
  if (!status) return isFetching ? <p className="text-xs text-muted-foreground">Prüfe Pfad…</p> : null;
  return <p className={`text-xs ${statusClass}`}>{status}</p>;
}

function liveStatusText(data: Inspect): string | null {
  if (!data.exists) return "Existiert noch nicht — wird beim Speichern angelegt, falls berechtigt.";
  if (!data.isDirectory) return "Kein Verzeichnis";
  if (!data.writable) return "Vorhanden, nicht beschreibbar";
  return null;
}

function liveStatusClass(data: Inspect): string {
  if (!data.exists) return "text-muted-foreground";
  if (!data.isDirectory) return "text-destructive";
  if (!data.writable) return "text-warning";
  return "text-success";
}

export function PathPickerField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  storageRoot,
  preferRelative = false,
  showStatus = true,
  volumeRootRelative,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  storageRoot?: string;
  preferRelative?: boolean;
  showStatus?: boolean;
  volumeRootRelative?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          className="font-mono text-xs"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          Durchsuchen
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {showStatus ? <PathLiveStatus value={value} /> : null}
      {open ? (
        <LinuxFolderBrowser
          initialPath={value}
          storageRoot={storageRoot}
          preferRelative={preferRelative}
          volumeRootRelative={volumeRootRelative}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function LinuxFolderBrowser({
  initialPath,
  storageRoot: storageRootProp,
  preferRelative,
  volumeRootRelative,
  onSelect,
  onClose,
}: {
  initialPath: string;
  storageRoot?: string;
  preferRelative: boolean;
  volumeRootRelative?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const storageQuery = useQuery({
    queryKey: ["admin-storage"],
    queryFn: () => api<{ storagePath: string; hostStorage: string }>("/api/admin/storage"),
    staleTime: 30_000,
  });
  const storageRoot = (storageRootProp || storageQuery.data?.storagePath || "/storage").replace(/\/+$/, "") || "/storage";
  const hostStorage = storageQuery.data?.hostStorage;

  const start = useMemo(() => {
    const raw = initialPath.trim();
    if (raw === "/" || raw === "") return "/";
    if (raw.startsWith("/")) return raw;
    return joinUnderRoot(storageRoot, raw);
  }, [initialPath, storageRoot]);

  const [cwd, setCwd] = useState(start);
  const [jump, setJump] = useState(start);
  const [filter, setFilter] = useState("");
  const [navigated, setNavigated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const [mkdirBusy, setMkdirBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (navigated) return;
    setCwd(start);
    setJump(start);
  }, [start, navigated]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previously = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (newFolder != null) {
          setNewFolder(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => filterRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
      previously?.focus();
    };
  }, [onClose, newFolder]);

  const { data, error, isFetching } = useQuery({
    queryKey: ["linux-browse", cwd],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("dir", cwd || "/");
      return api<Browse>(`/api/admin/storage/browse?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const current = isFetching ? cwd : (data?.path ?? cwd);
  const crumbs = breadcrumbs(current);
  const atRoot = current === "/";
  const activeTab = tabForPath(current, storageRoot);
  const shortcutByPath = new Map((data?.shortcuts ?? []).map((item) => [item.path, item]));
  const visible = (data?.entries ?? []).filter((entry) =>
    entry.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const rows: Array<{ id: string; label: string; path: string | null }> = [
    ...(atRoot ? [] : [{ id: "..", label: "..", path: data?.parent || "/" }]),
    ...visible.map((entry) => ({ id: entry.path, label: entry.name, path: entry.readable ? entry.path : null })),
  ];

  useEffect(() => {
    setJump(current);
    setFilter("");
    setActiveIndex(0);
    setNewFolder(null);
    setMkdirError(null);
  }, [current]);

  const go = (next: string) => {
    const target = next.trim() || "/";
    setNavigated(true);
    setCwd(target);
    setJump(target);
  };

  const choose = (absPath: string) => {
    if (absPath === "/") return;
    const host = (data?.hostStorage || hostStorage || "").replace(/\\/g, "/").replace(/\/+$/, "");
    const remapHostStorage = !storageRootProp;
    if (
      remapHostStorage &&
      host &&
      host.startsWith("/") &&
      (absPath === host || absPath.startsWith(`${host}/`))
    ) {
      const rest = absPath === host ? "" : absPath.slice(host.length + 1);
      if (!rest) {
        onSelect(preferRelative ? volumeRootRelative || "shared" : storageRoot);
        return;
      }
      onSelect(preferRelative ? rest : `${storageRoot}/${rest}`);
      return;
    }
    onSelect(toConfiguredFromAbsolute(absPath, storageRoot, preferRelative));
  };

  const createFolder = async () => {
    const name = (newFolder ?? "").trim();
    if (!name || mkdirBusy) return;
    setMkdirBusy(true);
    setMkdirError(null);
    try {
      const created = await api<{ path: string }>("/api/admin/storage/mkdir", {
        method: "POST",
        body: JSON.stringify({ dir: current, name }),
      });
      await qc.invalidateQueries({ queryKey: ["linux-browse"] });
      setNewFolder(null);
      go(created.path);
    } catch (err) {
      setMkdirError(err instanceof ApiRequestError ? err.message : "Ordner konnte nicht angelegt werden.");
    } finally {
      setMkdirBusy(false);
    }
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const role = target.getAttribute("data-role");
    if (event.key === "Tab") {
      const root = panelRef.current;
      if (!root) return;
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled])",
        ),
      ];
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          items[items.length - 1]?.focus();
        }
      } else if (index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
      return;
    }
    if (role === "jump") return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      choose(current);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(Math.max(rows.length - 1, 0), index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && role !== "mkdir") {
      const row = rows[activeIndex];
      if (row?.path) {
        event.preventDefault();
        go(row.path);
      }
    }
  };

  const takenAs = toConfiguredFromAbsolute(current, storageRoot, preferRelative);

  const dialog = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex h-[min(40rem,90dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-border bg-card shadow-[var(--ui-panel-hover-shadow)]"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="linux-folder-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="cloudora-section">Pfadauswahl</p>
            <h3 id="linux-folder-title" className="cloudora-title text-lg">
              Ordner auswählen
            </h3>
          </div>
          <button
            type="button"
            className="rounded-[var(--ui-radius)] p-1 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <SegmentTabs
          className="shrink-0 px-2"
          value={activeTab}
          onChange={(id) => {
            const tab = LOCATION_TABS.find((item) => item.id === id);
            if (!tab) return;
            go(id === "storage" ? storageRoot : tab.path);
          }}
          tabs={LOCATION_TABS.map((tab) => {
            const target = tab.id === "storage" ? storageRoot : tab.path;
            const shortcut = shortcutByPath.get(target);
            const knownMissing = Boolean(data) && tab.id !== "linux" && tab.id !== "storage" && !shortcut;
            return {
              id: tab.id,
              label: tab.label,
              disabled: knownMissing && tab.id !== "storage",
            };
          })}
        />

        <form
          className="flex shrink-0 gap-2 border-b border-border px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            go(jump);
          }}
        >
          <Input
            data-role="jump"
            className="font-mono text-xs"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
            aria-label="Pfad eingeben"
          />
          <Button type="submit" variant="outline" className="shrink-0">
            Gehen
          </Button>
        </form>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Input
            ref={filterRef}
            className="h-8 min-w-40 flex-1 text-xs"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Ordner filtern…"
            aria-label="Ordner filtern"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!data?.writable || atRoot}
            onClick={() => {
              setMkdirError(null);
              setNewFolder("");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Neuer Ordner
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-3 py-2 font-mono text-xs">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.path}:${index}`} className="inline-flex items-center">
              {index > 0 ? <ChevronRight className="mx-0.5 h-3 w-3 text-muted-foreground" /> : null}
              <button
                type="button"
                className={cn("rounded px-1 py-0.5 hover:bg-primary/15 hover:text-primary", current === crumb.path && "text-primary")}
                onClick={() => go(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          {isFetching ? <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">lädt…</span> : null}
        </div>

        {newFolder != null ? (
          <form
            className="flex shrink-0 gap-2 border-b border-border px-4 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <Input
              data-role="mkdir"
              autoFocus
              className="h-8 text-xs"
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder="Ordnername"
            />
            <Button type="submit" size="sm" disabled={mkdirBusy || !newFolder.trim()}>
              Anlegen
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNewFolder(null)}>
              Abbrechen
            </Button>
          </form>
        ) : null}
        {mkdirError ? <p className="shrink-0 px-4 py-1 text-xs text-destructive">{mkdirError}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {error ? (
            <p className="px-3 py-6 text-sm text-destructive">
              {error instanceof ApiRequestError ? error.message : "Verzeichnis konnte nicht gelesen werden."}
            </p>
          ) : null}
          {rows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              disabled={!row.path}
              className={cn(
                "flex w-full items-center gap-2 rounded-[var(--ui-radius)] px-3 py-2 text-left text-sm hover:bg-primary/10 disabled:opacity-40",
                index === activeIndex && "bg-primary/15",
              )}
              onClick={() => row.path && go(row.path)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {row.label === ".." ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-primary" />
              )}
              <span className="truncate">{row.label}</span>
            </button>
          ))}
          {data && visible.length === 0 && !isFetching && !error ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">{filter ? "Kein Treffer" : "Keine Unterordner"}</p>
          ) : null}
          {data?.truncated ? (
            <p className="px-3 py-2 text-xs text-warning">Liste auf 400 Ordner begrenzt. Filter nutzen oder tiefer navigieren.</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <HardDrive className="h-3 w-3 shrink-0" />
              <span className="truncate">{current}</span>
            </p>
            {atRoot ? (
              <p className="text-[11px] text-muted-foreground">
                Inhalt von / — wähle einen Unterordner (z. B. /mnt oder /home). Die Wurzel selbst kann nicht gelinkt werden.
              </p>
            ) : data?.writable === false ? (
              <p className="text-[11px] text-warning">Ordner vorhanden, aber nicht beschreibbar.</p>
            ) : null}
            {preferRelative && !atRoot ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                Wird {takenAs === current ? "absolut" : `relativ als ${takenAs}`} übernommen.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="button" disabled={atRoot} onClick={() => choose(current)}>
              Diesen Ordner wählen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(dialog, document.body);
}
