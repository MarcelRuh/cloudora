import { isBuildPhase } from "@/lib/utils";

function read(name: string, fallback = ""): string {
  const value = process.env[name];
  if (value != null && value !== "") return value;
  if (isBuildPhase()) return fallback || "build-placeholder";
  return fallback;
}

function readRequired(name: string, fallback = ""): string {
  const value = read(name, fallback);
  if (!value || value === "build-placeholder") {
    if (isBuildPhase()) return fallback || "build-placeholder";
  }
  return value;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getEnv() {
  const publicUrl = read("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, "");
  const https = publicUrl.startsWith("https://");
  return {
    nodeEnv: read("NODE_ENV", "development"),
    logLevel: read("LOG_LEVEL", "info"),
    port: parseIntEnv("PORT", 3000),
    publicUrl,
    trustProxy: parseBool(process.env.TRUST_PROXY, true),
    allowedOrigins: (process.env.APP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    databaseUrl: readRequired("DATABASE_URL", "postgresql://cloudora:cloudora@localhost:5432/cloudora?schema=public"),
    sessionSecret: readRequired("SESSION_SECRET", "change-me-to-a-long-random-session-secret"),
    encryptionKey: readRequired("ENCRYPTION_KEY", "change-me-to-a-long-random-encryption-key"),
    sessionDays: parseIntEnv("SESSION_DAYS", 7),
    cookieSecure: parseBool(process.env.COOKIE_SECURE, https),
    storagePath: read("CLOUDORA_STORAGE_PATH", "/storage"),
    hostStorage: read("CLOUDORA_HOST_STORAGE", "./storage"),
    usersDir: sanitizeRelDir(read("CLOUDORA_USERS_DIR", "users"), "users"),
    sharedDir: sanitizeRelDir(read("CLOUDORA_SHARED_DIR", "shared"), "shared"),
    maxUploadBytes: parseIntEnv("MAX_UPLOAD_BYTES", 32 * 1024 * 1024 * 1024),
    bootstrapAdminUsername: read("BOOTSTRAP_ADMIN_USERNAME", "admin"),
    bootstrapAdminPassword: read("BOOTSTRAP_ADMIN_PASSWORD", "changeme-now"),
    bootstrapAdminEmail: read("BOOTSTRAP_ADMIN_EMAIL", "admin@localhost"),
    repo: read("CLOUDORA_REPO", "MarcelRuh/cloudora"),
    branch: read("CLOUDORA_BRANCH", "main"),
    githubToken: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  };
}

function sanitizeRelDir(value: string, fallback: string): string {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0")) return fallback;
  return cleaned;
}

export type AppEnv = ReturnType<typeof getEnv>;
