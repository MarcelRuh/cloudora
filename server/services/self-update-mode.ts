export type SelfUpdateMode = "native" | "none";

export function resolveSelfUpdateMode(enabled: boolean): SelfUpdateMode {
  return enabled ? "native" : "none";
}

export function selfUpdateUnavailableMessage(): string {
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
