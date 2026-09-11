"use client";

import { useQuery } from "@tanstack/react-query";
import { Files, Folder, HardDrive, Upload, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes, greetingForNow, quotaPercent } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import { Card } from "@/components/ui/card";

type Stats = {
  storageUsed: number;
  storageTotal: number | null;
  quotaBytes: number | null;
  usedBytes: number;
  files: number;
  folders: number;
  users: number | null;
  uploads7d: number;
  downloads7d: number;
  activity: Array<{ id: string; action: string; target: string | null; createdAt: string; user: string }>;
};

export function DashboardView({ user }: { user: SessionUser }) {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Stats>("/api/dashboard"),
  });

  const quota = quotaPercent(user.usedBytes, user.quotaBytes);

  return (
    <div className="space-y-6">
      <div>
        <p className="cloudora-section">Cloudora</p>
        <h1 className="cloudora-title mt-1 text-3xl md:text-4xl">
          {greetingForNow()}, {user.displayName}
        </h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={HardDrive} label="Speicher" value={formatBytes(data?.usedBytes ?? user.usedBytes)}>
          <div className="cloudora-gauge mt-3">
            <span style={{ width: `${quota ?? 8}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatBytes(user.usedBytes)} / {user.quotaBytes == null ? "unbegrenzt" : formatBytes(user.quotaBytes)}
          </p>
        </StatCard>
        <StatCard icon={Files} label="Dateien" value={String(data?.files ?? "—")} />
        <StatCard icon={Folder} label="Ordner" value={String(data?.folders ?? "—")} />
        <StatCard icon={Users} label="Benutzer" value={data?.users == null ? "—" : String(data.users)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="cloudora-section">Letzte Aktivitäten</p>
          <div className="mt-4 space-y-3">
            {(data?.activity ?? []).map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 text-sm last:border-0">
                <div>
                  <p>
                    <span className="font-medium">{row.user}</span>{" "}
                    <span className="text-muted-foreground">{row.action}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{row.target || "—"}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
              </div>
            ))}
            {data && data.activity.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Aktivitäten.</p> : null}
          </div>
        </Card>
        <Card>
          <p className="cloudora-section">7 Tage</p>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <Upload className="h-4 w-4 text-primary" />
              <div>
                <p className="cloudora-stat text-2xl">{data?.uploads7d ?? "—"}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Uploads</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HardDrive className="h-4 w-4 text-accent" />
              <div>
                <p className="cloudora-stat text-2xl">{data?.downloads7d ?? "—"}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Downloads</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Files;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="cloudora-section">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="cloudora-stat mt-2 text-3xl">{value}</p>
      {children}
    </Card>
  );
}
