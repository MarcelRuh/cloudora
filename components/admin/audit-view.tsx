"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Row = { id: string; action: string; target: string | null; result: string; createdAt: string; user: string; ip: string | null };

export function AuditView() {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["audit", q],
    queryFn: () => api<{ items: Row[] }>(`/api/admin/audit?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Administration</p>
        <h1 className="cloudora-title text-2xl">Audit-Log</h1>
      </div>
      <Input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Zeit</th>
              <th className="px-4 py-3">Benutzer</th>
              <th className="px-4 py-3">Aktion</th>
              <th className="px-4 py-3">Ziel</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t border-white/5">
                <td className="px-4 py-3 text-xs">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-3">{row.user}</td>
                <td className="px-4 py-3">{row.action}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.target || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
