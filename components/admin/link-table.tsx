"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  path?: string;
  valid: boolean;
  revoked: boolean;
  createdAt: string;
  createdBy: { username: string; displayName: string };
  expiresAt?: string | null;
  downloadCount?: number;
  maxDownloads?: number;
  hasPassword?: boolean;
  permission?: string;
};

function statusLabel(item: Item) {
  if (item.valid) return "aktiv";
  if (item.revoked) return "gesperrt";
  return "abgelaufen";
}

export function LinkTable({ kind, manage = false }: { kind: "shares" | "downloads"; manage?: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [kind],
    queryFn: () => api<{ items: Item[] }>(`/api/${kind}`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/${kind}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Gesperrt");
      qc.invalidateQueries({ queryKey: [kind] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });
  const purge = useMutation({
    mutationFn: (id: string) => api(`/api/${kind}/${id}?hard=1`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Endgültig gelöscht");
      qc.invalidateQueries({ queryKey: [kind] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Datei</th>
            {manage ? <th className="px-4 py-3">Pfad</th> : null}
            <th className="px-4 py-3">Von</th>
            <th className="px-4 py-3">Erstellt</th>
            {manage ? <th className="px-4 py-3">Ablauf</th> : null}
            {manage ? <th className="px-4 py-3">Nutzung</th> : null}
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((item) => (
            <tr key={item.id} className="border-t border-white/5">
              <td className="px-4 py-3">
                <div className="font-medium">{item.name}</div>
                {item.hasPassword ? <div className="text-xs text-muted-foreground">Passwort</div> : null}
              </td>
              {manage ? <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.path || "—"}</td> : null}
              <td className="px-4 py-3 text-xs">{item.createdBy.displayName}</td>
              <td className="px-4 py-3 text-xs">{formatDateTime(item.createdAt)}</td>
              {manage ? (
                <td className="px-4 py-3 text-xs">{item.expiresAt ? formatDateTime(item.expiresAt) : "kein Ablauf"}</td>
              ) : null}
              {manage ? (
                <td className="px-4 py-3 text-xs">
                  {item.maxDownloads != null
                    ? `${item.downloadCount ?? 0} / ${item.maxDownloads}`
                    : String(item.downloadCount ?? 0)}
                </td>
              ) : null}
              <td className="px-4 py-3 text-xs">{statusLabel(item)}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  {item.valid ? (
                    <Button size="sm" variant="outline" onClick={() => revoke.mutate(item.id)}>
                      Sperren
                    </Button>
                  ) : null}
                  {manage ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (!confirm(`Link „${item.name}“ restlos löschen? Der Token ist danach ungültig.`)) return;
                        purge.mutate(item.id);
                      }}
                    >
                      Löschen
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.items.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          {kind === "shares"
            ? "Noch keine öffentlichen Links. Im Explorer über Teilen → Öffentlich."
            : "Noch keine Einmal-Links. Im Explorer über Teilen → Einmal."}
        </p>
      ) : null}
    </Card>
  );
}
