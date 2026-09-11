"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  valid: boolean;
  revoked: boolean;
  createdAt: string;
  createdBy: { username: string; displayName: string };
  expiresAt?: string | null;
  downloadCount?: number;
  maxDownloads?: number;
};

export function LinkTable({ kind }: { kind: "shares" | "downloads" }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [kind],
    queryFn: () => api<{ items: Item[] }>(`/api/${kind}`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/${kind}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Zurückgezogen");
      qc.invalidateQueries({ queryKey: [kind] });
    },
  });
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Datei</th>
            <th className="px-4 py-3">Erstellt</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((item) => (
            <tr key={item.id} className="border-t border-white/5">
              <td className="px-4 py-3">
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.createdBy.displayName}</div>
              </td>
              <td className="px-4 py-3 text-xs">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3 text-xs">{item.valid ? "aktiv" : item.revoked ? "ungültig" : "abgelaufen"}</td>
              <td className="px-4 py-3 text-right">
                {item.valid ? (
                  <Button size="sm" variant="outline" onClick={() => revoke.mutate(item.id)}>
                    Widerrufen
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.items.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Keine Einträge.</p> : null}
    </Card>
  );
}
