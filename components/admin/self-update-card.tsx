"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";

type SelfUpdateStatus = {
  enabled: boolean;
  mode?: "native" | "none";
  currentVersion: string;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  targetTag?: string | null;
  updating: boolean;
  progress: { percent: number; step: string; detail: string | null } | null;
  changelog: string | null;
  targetVersion: string | null;
  canApply?: boolean;
};

const STEP_LABELS: Record<string, string> = {
  cleanup: "Speicherplatz räumen",
  start: "Start",
  resolve: "GitHub-Revision ermitteln",
  sync: "Quellen synchronisieren",
  build: "Bauen",
  buildWeb: "Anwendung bauen",
  deps: "Abhängigkeiten",
  migrate: "Datenbank",
  startWeb: "Neustart",
  finalize: "Abschluss",
  done: "Fertig",
  error: "Fehler",
  apply: "Aktualisieren",
};

function shortRev(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* down during rebuild */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function SelfUpdateCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [optimisticProgress, setOptimisticProgress] = useState<SelfUpdateStatus["progress"]>(null);

  const { data: status } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/admin/system/self-update"),
    refetchInterval: (q) => (busy || q.state.data?.updating ? 1500 : 60_000),
  });

  const progress = status?.progress ?? optimisticProgress;
  const showProgress = Boolean(busy || status?.updating || progress?.step === "error");
  const percent = progress?.percent ?? (showProgress ? 2 : 0);
  const stepLabel = STEP_LABELS[progress?.step ?? ""] ?? STEP_LABELS.apply;
  const canApply = Boolean(status?.canApply);

  const handleApply = async () => {
    const from = status?.currentVersion ?? APP_VERSION;
    const to = status?.targetVersion ?? "latest";
    const ok = window.confirm(
      `Cloudora aktualisieren?\n\nHolt den Stand von GitHub, baut nativ und startet den systemd-Dienst neu. ${from} → ${to}.\nLokale Änderungen außer .env und Storage werden überschrieben.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setOptimisticProgress({ percent: 2, step: "start", detail: null });
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/admin/system/self-update", {
        method: "POST",
      });
      setSuccess(result.message);
      await qc.invalidateQueries({ queryKey: ["self-update"] });
      if (!result.ok) {
        setBusy(false);
        return;
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Update fehlgeschlagen.");
      return;
    }

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await qc.invalidateQueries({ queryKey: ["self-update"] });
        const next = qc.getQueryData<SelfUpdateStatus>(["self-update"]);
        if (next && !next.updating) break;
      } catch {
        /* API down during rebuild */
      }
    }
    const healthy = await waitForHealth();
    setSuccess(healthy ? "Health-Check OK — lade neu…" : "Update fertig. Seite manuell neu laden…");
    setBusy(false);
    if (healthy) window.setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cloudora-section">Cloudora Self-Update</p>
          <p className="cloudora-stat mt-2 text-3xl">v{status?.currentVersion ?? APP_VERSION}</p>
        </div>
        {status?.updateAvailable ? (
          <span className="rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">Update verfügbar</span>
        ) : (
          <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">Aktuell</span>
        )}
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="mt-3 whitespace-pre-wrap text-sm text-success">{success}</p> : null}
      {status ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
          {status.updateAvailable ? (
            <p className="mt-2 font-mono text-lg font-semibold">
              {status.currentVersion} <span className="text-muted-foreground">→</span>{" "}
              <span className="text-primary">{status.targetVersion ?? "latest"}</span>
            </p>
          ) : null}
          <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <dt>Repository</dt>
            <dd>
              {status.repo}@{status.targetTag ?? status.branch}
            </dd>
            <dt>Installationspfad</dt>
            <dd>{status.installDir ?? "—"}</dd>
            <dt>Betrieb</dt>
            <dd>Native (systemd)</dd>
            <dt>Lokal</dt>
            <dd className="font-mono">{shortRev(status.localRevision)}</dd>
            <dt>Remote</dt>
            <dd className="font-mono">{shortRev(status.remoteRevision)}</dd>
          </dl>
          {showProgress ? (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span>{stepLabel}</span>
                <span>{Math.round(percent)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${progress?.step === "error" ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
                />
              </div>
              {progress?.detail ? <p className="text-xs text-muted-foreground">{progress.detail}</p> : null}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: ["self-update"] })}>
              Prüfen
            </Button>
            {canApply ? (
              <Button
                size="sm"
                disabled={busy || status.updating || status.mode === "none" || !status.updateAvailable}
                onClick={() => void handleApply()}
              >
                {busy || status.updating ? "Aktualisiere…" : "Jetzt aktualisieren"}
              </Button>
            ) : null}
          </div>
          {status.changelog ? (
            <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {status.changelog}
            </pre>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Prüfe GitHub…</p>
      )}
    </Card>
  );
}
