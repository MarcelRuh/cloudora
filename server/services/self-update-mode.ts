export type SelfUpdateMode = "native" | "docker" | "none";
export type SelfUpdateSidecar = "ready" | "missing" | "host";

export function resolveSelfUpdateMode(sidecar: SelfUpdateSidecar, enabled: boolean): SelfUpdateMode {
  if (!enabled) return "none";
  if (sidecar === "ready") return "docker";
  if (sidecar === "host") return "native";
  return "none";
}

export function selfUpdateUnavailableMessage(sidecar: SelfUpdateSidecar): string {
  if (sidecar === "missing") {
    return "Self-Update-Sidecar fehlt. Docker-Stack mit docker compose up -d neu erzeugen.";
  }
  return "Self-Update nicht verfügbar. CLOUDORA_INSTALL_DIR auf den Installationspfad setzen (z. B. /opt/cloudora).";
}

export function selfUpdateReadyMessage(input: {
  updating: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  targetVersion: string | null;
  shaError: string | null;
}): string {
  if (input.updating) return "Update läuft…";
  if (input.shaError && !input.updateAvailable) {
    return `GitHub-Prüfung fehlgeschlagen: ${input.shaError}`;
  }
  if (input.updateAvailable) {
    return input.targetVersion
      ? `Update verfügbar — ${input.currentVersion} → ${input.targetVersion}`
      : "Update von GitHub verfügbar";
  }
  return "Aktuell";
}
