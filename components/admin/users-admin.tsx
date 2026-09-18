"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { PathPickerField } from "@/components/admin/path-picker";
import { QuotaField } from "@/components/admin/quota-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { SegmentTabs } from "@/components/ui/tabs";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { suggestUserHome } from "@/lib/posix-path";
import type { SessionUser } from "@/lib/types";

export function UsersAdmin() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: SessionUser[] }>("/api/users") });
  const storage = useQuery({
    queryKey: ["admin-storage"],
    queryFn: () => api<{ storagePath: string; usersDir: string }>("/api/admin/storage"),
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<Partial<SessionUser> & { password?: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"account" | "storage" | "rights">("account");
  const autoHome = useRef("");
  const appliedQueryId = useRef<string | null>(null);
  const closedQueryId = useRef<string | null>(null);

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) {
      appliedQueryId.current = null;
      return;
    }
    if (closedQueryId.current === id || appliedQueryId.current === id || !data?.users) return;
    const user = data.users.find((item) => item.id === id);
    if (!user) return;
    appliedQueryId.current = id;
    closedQueryId.current = null;
    setCreating(false);
    setEditing(user);
    const nextTab = searchParams.get("tab");
    if (nextTab === "storage" || nextTab === "rights" || nextTab === "account") setTab(nextTab);
  }, [data, searchParams]);

  const closeEditor = () => {
    closedQueryId.current = searchParams.get("id");
    setEditing(null);
    setCreating(false);
    if (searchParams.get("id")) router.replace("/admin/users");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (creating) {
        return api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            ...editing,
            quotaBytes: editing.quotaBytes ?? null,
            roleSlug: editing.role?.slug ?? "user",
          }),
        });
      }
      return api(`/api/users/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          username: editing.username,
          displayName: editing.displayName,
          email: editing.email,
          password: editing.password || undefined,
          status: editing.status,
          roleSlug: editing.role?.slug,
          homePathEnabled: editing.homePathEnabled,
          homePath: editing.homePath,
          quotaBytes: editing.quotaBytes,
          canUpload: editing.canUpload,
          canDownload: editing.canDownload,
          canDelete: editing.canDelete,
          canEdit: editing.canEdit,
          canShare: editing.canShare,
          canOneTimeDownload: editing.canOneTimeDownload,
        }),
      });
    },
    onSuccess: () => {
      toast.success(creating ? "Benutzer angelegt. Als Nächstes: Ordnerzugriff unter Speicher." : "Gespeichert");
      closeEditor();
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const usersDir = storage.data?.usersDir || "users";
  const storageRoot = storage.data?.storagePath;

  const setUsername = (username: string) => {
    if (!editing) return;
    const next: Partial<SessionUser> & { password?: string } = { ...editing, username };
    if (creating) {
      const suggested = suggestUserHome(usersDir, username);
      if (!editing.homePath || editing.homePath === autoHome.current) {
        next.homePath = suggested;
        autoHome.current = suggested;
      }
    }
    setEditing(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="cloudora-section">Administration</p>
          <h1 className="cloudora-title text-2xl">Benutzer</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Schritt 1: Konto anlegen. Explorer-Ordner danach unter{" "}
            <Link href="/admin/storage" className="font-medium text-foreground underline-offset-2 hover:underline">
              Speicher → Ordnerzugriff
            </Link>
            .
          </p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
            setTab("account");
            autoHome.current = "";
            setEditing({
              username: "",
              displayName: "",
              email: "",
              status: "ACTIVE",
              homePathEnabled: true,
              homePath: "",
              quotaBytes: null,
              canUpload: true,
              canDownload: true,
              canDelete: true,
              canEdit: true,
              canShare: true,
              canOneTimeDownload: true,
              role: { id: "", name: "Benutzer", slug: "user", permissions: [] },
            });
          }}
        >
          Benutzer anlegen
        </Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Benutzer</th>
              <th className="px-4 py-3">Rolle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Home</th>
              <th className="px-4 py-3">Speicher</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-white/5">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.displayName}</div>
                  <div className="text-xs text-muted-foreground">{u.username} · {u.email}</div>
                </td>
                <td className="px-4 py-3">{u.role.name}</td>
                <td className="px-4 py-3">{u.status === "ACTIVE" ? "Aktiv" : "Deaktiviert"}</td>
                <td className="px-4 py-3 font-mono text-xs">{u.homePathEnabled ? u.homePath || "—" : "aus"}</td>
                <td className="px-4 py-3 text-xs">
                  {formatBytes(u.usedBytes)} / {u.quotaBytes == null ? "∞" : formatBytes(u.quotaBytes)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => { setCreating(false); setTab("account"); setEditing(u); }}>
                    Bearbeiten
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeEditor}>
          <form
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--ui-radius-panel)] border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="shrink-0 px-5 pt-5">
              <h2 className="cloudora-title text-lg">{creating ? "Neuer Benutzer" : "Benutzer bearbeiten"}</h2>
            </div>
            <SegmentTabs
              className="mt-3 shrink-0 px-3"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "account", label: "Konto" },
                { id: "storage", label: "Speicher" },
                { id: "rights", label: "Rechte" },
              ]}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {tab === "account" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Benutzername" value={editing.username ?? ""} onChange={setUsername} />
              <Field label="Anzeigename" value={editing.displayName ?? ""} onChange={(v) => setEditing({ ...editing, displayName: v })} />
              <Field label="E-Mail" value={editing.email ?? ""} onChange={(v) => setEditing({ ...editing, email: v })} />
              <Field label="Passwort" type="password" value={editing.password ?? ""} onChange={(v) => setEditing({ ...editing, password: v })} />
              <div className="space-y-1.5">
                <Label>Rolle</Label>
                <Select
                  value={editing.role?.slug ?? "user"}
                  onChange={(e) => setEditing({ ...editing, role: { ...(editing.role as SessionUser["role"]), slug: e.target.value, name: e.target.value, id: editing.role?.id ?? "", permissions: [] } })}
                >
                  <option value="user">Benutzer</option>
                  <option value="administrator">Administrator</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as SessionUser["status"] })}>
                  <option value="ACTIVE">Aktiv</option>
                  <option value="DISABLED">Deaktiviert</option>
                </Select>
              </div>
            </div>
            ) : null}
            {tab === "storage" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Home ist der persönliche Ordner dieses Kontos. Gemeinsame oder Host-Ordner weist du unter{" "}
                <Link href="/admin/storage" className="font-medium text-foreground underline-offset-2 hover:underline">
                  Speicher → Ordnerzugriff
                </Link>{" "}
                zu — nicht hier.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(editing.homePathEnabled)} onChange={(e) => setEditing({ ...editing, homePathEnabled: e.target.checked })} />
                Persönlicher Home-Pfad aktiviert
              </label>
              <PathPickerField
                label="Home-Pfad"
                value={editing.homePath ?? ""}
                onChange={(v) => {
                  autoHome.current = "";
                  setEditing({ ...editing, homePath: v });
                }}
                storageRoot={storageRoot}
                preferRelative
                placeholder={suggestUserHome(usersDir, editing.username ?? "") || "users/anna"}
                hint="Unter dem Storage-Root relativ (users/anna), sonst absolut (/home/anna). Der Benutzer sieht diesen Ordner als /."
              />
              <QuotaField
                value={editing.quotaBytes ?? null}
                onChange={(quotaBytes) => setEditing({ ...editing, quotaBytes })}
              />
            </div>
            ) : null}
            {tab === "rights" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Was das Konto grundsätzlich darf. Das weist noch keinen Ordner im Explorer zu.
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ["canUpload", "Upload"],
                  ["canDownload", "Download"],
                  ["canDelete", "Löschen"],
                  ["canEdit", "Bearbeiten"],
                  ["canShare", "Öffentliche Links"],
                  ["canOneTimeDownload", "Einmal-Links"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(editing[key])} onChange={(e) => setEditing({ ...editing, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
              </div>
            </div>
            ) : null}
            </div>
            <div className="flex shrink-0 justify-between border-t border-border px-5 py-4">
              {!creating && editing.id ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={async () => {
                    if (!confirm("Benutzer wirklich löschen?")) return;
                    try {
                      await api(`/api/users/${editing.id}`, { method: "DELETE" });
                      toast.success("Gelöscht");
                      closeEditor();
                      qc.invalidateQueries({ queryKey: ["users"] });
                    } catch (e) {
                      toast.error(e instanceof ApiRequestError ? e.message : "Fehler");
                    }
                  }}
                >
                  Löschen
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={closeEditor}>
                  Abbrechen
                </Button>
                <Button type="submit">{save.isPending ? "…" : "Speichern"}</Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        className={mono ? "font-mono text-xs" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
