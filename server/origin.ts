import { AppError } from "@/lib/errors";

export function originIsAllowed(
  origin: string | null,
  cfg: {
    publicUrl: string;
    allowedOrigins: string[];
    host: string | null;
    proto: string;
    requireOrigin?: boolean;
    allowHostHttpAndHttps?: boolean;
  },
): void {
  if (!origin) {
    if (cfg.requireOrigin !== false) {
      throw new AppError("CSRF", "Ungültige Herkunft der Anfrage.", 403);
    }
    return;
  }
  const allowed = new Set<string>([cfg.publicUrl, ...cfg.allowedOrigins]);
  try {
    allowed.add(new URL(cfg.publicUrl).origin);
  } catch {
    /* ignore */
  }
  const host = cfg.host?.split(",")[0]?.trim();
  if (host) {
    allowed.add(`${cfg.proto}://${host}`);
    if (cfg.allowHostHttpAndHttps) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
  }
  const originUrl = origin.replace(/\/$/, "");
  if (![...allowed].some((item) => item.replace(/\/$/, "") === originUrl)) {
    throw new AppError("CSRF", "Ungültige Herkunft der Anfrage.", 403);
  }
}
