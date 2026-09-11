"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import { TotpQr } from "@/components/settings/totp-qr";

type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

type Payload = { user: SessionUser; sessions: SessionRow[] };

export function SettingsView() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api<Payload>("/api/settings") });
  const [displayName, setDisplayName] = useState("");
  const [appearance, setAppearance] = useState("dark");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);

  const user = data?.user;
  const save = useMutation({
    mutationFn: () =>
      api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName || user?.displayName,
          appearance,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Gespeichert");
      setCurrentPassword("");
      setNewPassword("");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const totp = useMutation({
    mutationFn: (body: { action: "begin" | "confirm" | "disable"; password?: string; code?: string }) =>
      api<{ secret?: string; otpauthUrl?: string }>("/api/settings/totp", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res, vars) => {
      if (vars.action === "begin" && res.secret && res.otpauthUrl) {
        setSetup({ secret: res.secret, otpauthUrl: res.otpauthUrl });
        toast.success("QR-Code scannen oder Secret in der Authenticator-App eintragen.");
        return;
      }
      setSetup(null);
      setTotpPassword("");
      setTotpCode("");
      toast.success(vars.action === "disable" ? "2FA deaktiviert" : "2FA aktiv");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) => api<{ current?: boolean }>(`/api/settings/sessions/${id}`, { method: "DELETE" }),
    onSuccess: (res) => {
      if (res.current) {
        router.push("/login");
        router.refresh();
        return;
      }
      toast.success("Sitzung beendet");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api("/api/settings/sessions", { method: "POST", body: JSON.stringify({ keepCurrent: true }) }),
    onSuccess: () => {
      toast.success("Andere Sitzungen beendet");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Fehler"),
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Einstellungen</p>
        <h1 className="cloudora-title text-2xl">Profil</h1>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Profil</h2>
          <Label>Anzeigename</Label>
          <Input defaultValue={user?.displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <div className="mt-3">
            <Label>Erscheinungsbild</Label>
            <Select defaultValue={user?.appearance ?? "dark"} onChange={(e) => setAppearance(e.target.value)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </div>
          <div className="mt-4">
            <Button onClick={() => save.mutate()}>Speichern</Button>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Passwort</h2>
          <Label>Aktuelles Passwort</Label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <div className="mt-3">
            <Label>Neues Passwort</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="mt-4">
            <Button onClick={() => save.mutate()}>Passwort ändern</Button>
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Zwei-Faktor-Authentifizierung</h2>
          {user?.totpEnabled ? (
            <>
              <p className="mb-3 text-sm text-success">2FA ist aktiv.</p>
              <Label>Aktuelles Passwort</Label>
              <Input type="password" value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} />
              <div className="mt-3">
                <Label>Aktueller 2FA-Code</Label>
                <Input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
              </div>
              <Button
                className="mt-4"
                variant="danger"
                onClick={() => totp.mutate({ action: "disable", password: totpPassword, code: totpCode })}
              >
                2FA deaktivieren
              </Button>
            </>
          ) : setup ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                QR-Code mit der Authenticator-App scannen (Google Authenticator, Aegis, …). Alternativ Secret manuell eintragen.
              </p>
              <div className="mb-3 flex justify-center">
                <TotpQr value={setup.otpauthUrl} />
              </div>
              <Label>Secret</Label>
              <Input readOnly value={setup.secret} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{setup.otpauthUrl}</p>
              <div className="mt-3">
                <Label>Bestätigungscode</Label>
                <Input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
              </div>
              <Button className="mt-4" onClick={() => totp.mutate({ action: "confirm", code: totpCode })}>
                2FA aktivieren
              </Button>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">Schützt die Anmeldung mit einem zeitbasierten Code (TOTP).</p>
              <Label>Aktuelles Passwort</Label>
              <Input type="password" value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} />
              <Button className="mt-4" onClick={() => totp.mutate({ action: "begin", password: totpPassword })}>
                2FA einrichten
              </Button>
            </>
          )}
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Sitzungen</h2>
            {(data?.sessions.length ?? 0) > 1 ? (
              <Button size="sm" variant="outline" onClick={() => revokeOthers.mutate()}>
                Andere beenden
              </Button>
            ) : null}
          </div>
          <div className="space-y-2 text-sm">
            {(data?.sessions ?? []).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 border-b border-white/5 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span>{s.ip || "unbekannt"}</span>
                    {s.current ? (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                        Diese Sitzung
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{s.userAgent || "—"}</p>
                  <p className="text-xs text-muted-foreground">Seit {formatDateTime(s.createdAt)}</p>
                </div>
                <Button size="sm" variant={s.current ? "danger" : "outline"} onClick={() => revokeOne.mutate(s.id)}>
                  Beenden
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
