"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UiAtmosphere } from "@/components/layout/ui-atmosphere";
import { BrandMark } from "@/components/layout/brand-mark";
import { api, ApiRequestError } from "@/lib/api";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [totpNeeded, setTotpNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, totp: totp || undefined }),
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "TOTP_REQUIRED") {
          setTotpNeeded(true);
          setError("Bitte den 2FA-Code aus der Authenticator-App eingeben.");
        } else if (err.code === "INVALID_TOTP") setError("Der 2FA-Code ist ungültig.");
        else if (err.code === "RATE_LIMITED") setError(err.message);
        else if (err.code === "ACCOUNT_DISABLED") setError("Dieses Konto ist deaktiviert.");
        else setError("Benutzername oder Passwort ist falsch.");
      } else {
        setError("Anmeldung fehlgeschlagen.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <UiAtmosphere />
      <Card className="relative z-10 w-full max-w-md p-0">
        <CardHeader>
          <BrandMark className="mb-3 h-12 w-12" size={48} />
          <CardTitle className="cloudora-logo text-2xl">{APP_NAME.toUpperCase()}</CardTitle>
          <CardDescription>Self-Hosted Cloud Storage</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="space-y-1.5">
              <Label htmlFor="username">Benutzername oder E-Mail</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={!totpNeeded}
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {totpNeeded ? (
              <div className="space-y-1.5">
                <Label htmlFor="totp">2FA-Code</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full uppercase tracking-wider" disabled={busy}>
              {busy ? "Anmeldung…" : "Anmelden"}
            </Button>
          </form>
          <p className="mt-6 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            {APP_NAME} v{APP_VERSION}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
