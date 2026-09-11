"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  originalPath: string;
  isDir: boolean;
  size: number;
  deletedAt: string;
  expiresAt: string;
};

export function TrashView() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["trash"], queryFn: () => api<{ items: Item[] }>("/api/trash") });
  const act = useMutation({
    mutationFn: (body: { action: "restore" | "purge" | "empty"; id?: string }) =>
      api("/api/trash", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_res, vars) => {
      toast.success(vars.action === "restore" ? "Wiederhergestellt" : vars.action === "empty" ? "Papierkorb geleert" : "Endgültig gelöscht");
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="cloudora-section">Cloudora</p>
          <h1 className="cloudora-title text-2xl">Papierkorb</h1>
          <p className="mt-1 text-sm text-muted-foreground">Einträge werden nach 30 Tagen automatisch endgültig gelöscht.</p>
        </div>
        {(data?.items.length ?? 0) > 0 ? (
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Papierkorb wirklich leeren? Das kann nicht rückgängig gemacht werden.")) {
                act.mutate({ action: "empty" });
              }
            }}
          >
            Leeren
          </Button>
        ) : null}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Herkunft</th>
              <th className="px-4 py-3">Gelöscht</th>
              <th className="px-4 py-3">Ende</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{item.isDir ? "Ordner" : formatBytes(item.size)}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{item.originalPath}</td>
                <td className="px-4 py-3 text-xs">{formatDateTime(item.deletedAt)}</td>
                <td className="px-4 py-3 text-xs">{formatDateTime(item.expiresAt)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "restore", id: item.id })}>
                      Wiederherstellen
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (confirm("Endgültig löschen?")) act.mutate({ action: "purge", id: item.id });
                      }}
                    >
                      Löschen
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Der Papierkorb ist leer.</p> : null}
      </Card>
    </div>
  );
}
