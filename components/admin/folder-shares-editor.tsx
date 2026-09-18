"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PathPickerField } from "@/components/admin/path-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

type Access = "READ" | "WRITE";

type Grant = {
  id?: string;
  userId?: string | null;
  roleId?: string | null;
  access: Access;
  subPath?: string;
  user?: { id: string; username: string; displayName: string } | null;
  role?: { id: string; name: string; slug: string } | null;
};

type FolderShare = {
  id: string;
  name: string;
  slug: string;
  hostPath: string;
  comment: string;
  enabled: boolean;
  grants: Grant[];
};

type Draft = {
  id?: string;
  name: string;
  slug: string;
  hostPath: string;
  comment: string;
  enabled: boolean;
  grants: Grant[];
};

function emptyDraft(): Draft {
  return { name: "", slug: "", hostPath: "/mnt/cloudora", comment: "", enabled: true, grants: [] };
}

function emptyGrant(): Grant {
  return { userId: null, roleId: null, access: "WRITE", subPath: "" };
}

function whoLabel(grant: Grant): string {
  return grant.user?.displayName || grant.role?.name || "—";
}

function folderLabel(grant: Grant): string {
  return grant.subPath?.trim() ? grant.subPath : "gesamter Ordner";
}

function accessLabel(access: Access): string {
  return access === "WRITE" ? "Schreiben" : "Lesen";
}

export function FolderSharesEditor() {
  const qc = useQueryClient();
  const shares = useQuery({
    queryKey: ["folder-shares"],
    queryFn: () => api<{ shares: FolderShare[] }>("/api/admin/storage/folder-shares"),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: SessionUser[] }>("/api/users"),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: Array<{ id: string; name: string; slug: string }> }>("/api/admin/roles"),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quickUser, setQuickUser] = useState("");
  const [quickPath, setQuickPath] = useState("/mnt/cloudora");
  const [quickAccess, setQuickAccess] = useState<Access>("WRITE");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folder-shares"] });
    qc.invalidateQueries({ queryKey: ["admin-storage"] });
    qc.invalidateQueries({ queryKey: ["files"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const body = {
        name: draft.name,
        slug: draft.slug || undefined,
        hostPath: draft.hostPath,
        comment: draft.comment,
        enabled: draft.enabled,
        grants: draft.grants.map((g) => ({
          userId: g.userId || null,
          roleId: g.roleId || null,
          access: g.access,
          subPath: g.subPath ?? "",
        })),
      };
      if (draft.id) {
        return api(`/api/admin/storage/folder-shares/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return api("/api/admin/storage/folder-shares", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success("Zugriff gespeichert");
      setDraft(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const quick = useMutation({
    mutationFn: () =>
      api("/api/admin/storage/folder-shares/grant", {
        method: "POST",
        body: JSON.stringify({
          userId: quickUser.startsWith("user:") ? quickUser.slice(5) : null,
          roleId: quickUser.startsWith("role:") ? quickUser.slice(5) : null,
          hostPath: quickPath,
          access: quickAccess,
        }),
      }),
    onSuccess: () => {
      toast.success("Ordnerzugriff gespeichert");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/admin/storage/folder-shares/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Zugriff entfernt");
      setDraft(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const roleChoices = useMemo(
    () => (roles.data?.roles ?? []).filter((r) => r.slug !== "administrator"),
    [roles.data],
  );
  const people = users.data?.users ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <p className="cloudora-section">1 · Ordner zuweisen</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Wähle Benutzer, Host-Ordner und Lesen oder Schreiben. Das erscheint danach im Explorer — kein öffentlicher
          Link. Ein Unterordner wie <span className="font-mono">/mnt/cloudora/shared/test</span> gibt nur diesen Ordner,
          nicht <span className="font-mono">shared</span>.
        </p>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[1fr_minmax(0,1.4fr)_8rem_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            quick.mutate();
          }}
        >
          <div>
            <Label>Benutzer</Label>
            <Select value={quickUser} onChange={(e) => setQuickUser(e.target.value)} required>
              <option value="">Auswählen…</option>
              {people.map((user) => (
                <option key={user.id} value={`user:${user.id}`}>
                  {user.displayName}
                </option>
              ))}
              {roleChoices.map((role) => (
                <option key={role.id} value={`role:${role.id}`}>
                  Rolle: {role.name}
                </option>
              ))}
            </Select>
          </div>
          <PathPickerField
            label="Ordner"
            value={quickPath}
            onChange={setQuickPath}
            storageRoot="/mnt"
            placeholder="/mnt/cloudora/shared/test"
            showStatus={false}
          />
          <div>
            <Label>Lesen / Schreiben</Label>
            <Select value={quickAccess} onChange={(e) => setQuickAccess(e.target.value as Access)}>
              <option value="READ">Lesen</option>
              <option value="WRITE">Schreiben</option>
            </Select>
          </div>
          <Button type="submit" disabled={quick.isPending || !quickUser}>
            {quick.isPending ? "…" : "Zugriff geben"}
          </Button>
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="cloudora-section">2 · Zugewiesene Ordner</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Basis-Ordner und wer welchen Unterordner sieht. Administratoren haben immer Zugriff auf alles.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
            Host-Ordner anbinden
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Basis-Pfad</th>
                <th className="py-2 pr-3">Zugriff</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(shares.data?.shares ?? []).map((share) => (
                <tr key={share.id} className="border-t border-border align-top">
                  <td className="py-3 pr-3">
                    <p className="font-medium">{share.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">/{share.slug}</p>
                    {!share.enabled ? <p className="text-xs text-warning">deaktiviert</p> : null}
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs">{share.hostPath}</td>
                  <td className="py-3 pr-3">
                    {share.grants.length ? (
                      <ul className="space-y-1 text-xs">
                        {share.grants.map((g, i) => (
                          <li key={g.id || i}>
                            <span className="font-medium text-foreground">{whoLabel(g)}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              → {folderLabel(g)} ({accessLabel(g.access)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">nur Admins</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDraft({ ...share })}>
                      Bearbeiten
                    </Button>
                  </td>
                </tr>
              ))}
              {(shares.data?.shares ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-sm text-muted-foreground">
                    Noch kein Ordnerzugriff. Oben einen Ordner zuweisen oder einen Host-Ordner anbinden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {draft ? (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="cloudora-section">{draft.id ? "Zugriff bearbeiten" : "Host-Ordner anbinden"}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Anzeigename</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="cloudora"
                  required
                />
              </div>
              <div>
                <Label>Slug</Label>
                <Input
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  placeholder="cloudora"
                />
              </div>
            </div>
            <PathPickerField
              label="Basis-Pfad"
              value={draft.hostPath}
              onChange={(hostPath) => setDraft({ ...draft, hostPath })}
              storageRoot="/mnt"
              placeholder="/mnt/cloudora"
              showStatus={false}
              hint="Nur dieser Baum. Zugriff unten gilt für die ganze Basis oder einzelne Unterordner."
            />
            <div>
              <Label>Kommentar</Label>
              <Input value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Aktiv
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Wer darf welchen Ordner?</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft({ ...draft, grants: [...draft.grants, emptyGrant()] })}
                >
                  Recht hinzufügen
                </Button>
              </div>
              {draft.grants.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Einträge — nur Administratoren sehen die Basis.</p>
              ) : null}
              {draft.grants.map((grant, idx) => (
                <div key={idx} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[12rem_minmax(0,1fr)_8rem_auto] md:items-end">
                  <div>
                    <Label>Benutzer</Label>
                    <Select
                      value={grant.roleId ? `role:${grant.roleId}` : grant.userId ? `user:${grant.userId}` : ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        const next = [...draft.grants];
                        if (value.startsWith("role:")) next[idx] = { ...grant, roleId: value.slice(5), userId: null };
                        else if (value.startsWith("user:")) next[idx] = { ...grant, userId: value.slice(5), roleId: null };
                        else next[idx] = { ...grant, userId: null, roleId: null };
                        setDraft({ ...draft, grants: next });
                      }}
                    >
                      <option value="">Auswählen…</option>
                      {people.map((user) => (
                        <option key={user.id} value={`user:${user.id}`}>
                          {user.displayName}
                        </option>
                      ))}
                      {roleChoices.map((role) => (
                        <option key={role.id} value={`role:${role.id}`}>
                          Rolle: {role.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <PathPickerField
                    label="Ordner in der Basis"
                    value={grant.subPath ?? ""}
                    onChange={(subPath) => {
                      const next = [...draft.grants];
                      next[idx] = { ...grant, subPath };
                      setDraft({ ...draft, grants: next });
                    }}
                    storageRoot={draft.hostPath}
                    preferRelative
                    showStatus={false}
                    placeholder="leer = gesamter Ordner, z. B. shared/test"
                    hint="Leer = die ganze Basis. shared/test = nur dieser Unterordner, nicht shared."
                  />
                  <div>
                    <Label>Recht</Label>
                    <Select
                      value={grant.access}
                      onChange={(e) => {
                        const next = [...draft.grants];
                        next[idx] = { ...grant, access: e.target.value as Access };
                        setDraft({ ...draft, grants: next });
                      }}
                    >
                      <option value="READ">Lesen</option>
                      <option value="WRITE">Schreiben</option>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft({ ...draft, grants: draft.grants.filter((_, i) => i !== idx) })}
                  >
                    Entfernen
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "…" : "Speichern"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Abbrechen
              </Button>
              {draft.id ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    if (confirm("Zugriff wirklich entfernen? Dateien auf der Platte bleiben.")) remove.mutate(draft.id!);
                  }}
                >
                  Löschen
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
