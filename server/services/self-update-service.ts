import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { APP_VERSION, DEFAULT_GITHUB_BRANCH, DEFAULT_GITHUB_REPO, isSelfUpdateAvailable, selfUpdateTargetVersion } from "@/lib/version";
import {
  fetchGithubChangelog,
  fetchGithubCommitSha,
  fetchGithubLatestRelease,
  fetchGithubPackageVersion,
} from "@/server/services/github-revision";
import {
  resolveSelfUpdateMode,
  selfUpdateReadyMessage,
  selfUpdateUnavailableMessage,
  type SelfUpdateMode,
} from "@/server/services/self-update-mode";
import { readProgressFromDir, REVISION_FILE, type SelfUpdateProgress } from "@/server/services/self-update-progress";

const execFileAsync = promisify(execFile);
const APPLY_TIMEOUT_MS = 20 * 60 * 1000;

export type { SelfUpdateMode };

export type SelfUpdateStatus = {
  enabled: boolean;
  mode: SelfUpdateMode;
  currentVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  targetTag: string | null;
  updating: boolean;
  progress: SelfUpdateProgress | null;
  changelog: string | null;
  targetVersion: string | null;
};

let applyInFlight = false;

function options() {
  return {
    installDir: process.env.CLOUDORA_INSTALL_DIR?.trim() || process.cwd(),
    repo: process.env.CLOUDORA_REPO ?? DEFAULT_GITHUB_REPO,
    branch: process.env.CLOUDORA_BRANCH ?? DEFAULT_GITHUB_BRANCH,
  };
}

function progressDir(): string | null {
  const dir = options().installDir;
  return dir && existsSync(dir) ? dir : null;
}

function readSourceVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readLocalRevision(dir: string | null): string | null {
  if (!dir) return process.env.GIT_SHA ?? null;
  const file = path.join(dir, REVISION_FILE);
  if (existsSync(file)) {
    try {
      return readFileSync(file, "utf8").trim() || null;
    } catch {
      /* ignore */
    }
  }
  return process.env.GIT_SHA ?? null;
}

function isUpdaterRunning(): boolean {
  const dir = progressDir();
  if (!dir) return false;
  if (existsSync(path.join(dir, ".cloudora-update.lock"))) return true;
  const file = readProgressFromDir(dir);
  return Boolean(file && file.step !== "done" && file.step !== "error");
}

export async function getSelfUpdateStatus(): Promise<SelfUpdateStatus> {
  const opts = options();
  const updating = applyInFlight || isUpdaterRunning();
  const sourceDir = existsSync(path.join(opts.installDir, "package.json")) ? opts.installDir : null;
  const sourceVersion = sourceDir ? readSourceVersion(opts.installDir) : null;
  const enabled = Boolean(opts.installDir);
  const mode = resolveSelfUpdateMode(enabled);

  const base: SelfUpdateStatus = {
    enabled,
    mode,
    currentVersion: APP_VERSION,
    sourceVersion,
    remoteVersion: null,
    localRevision: readLocalRevision(progressDir()),
    remoteRevision: null,
    updateAvailable: false,
    message: enabled ? "Prüfe GitHub…" : selfUpdateUnavailableMessage(),
    installDir: opts.installDir,
    repo: opts.repo,
    branch: opts.branch,
    targetTag: null,
    updating,
    progress: null,
    changelog: null,
    targetVersion: null,
  };

  if (!enabled) return withProgress(base);

  let remoteRevision: string | null = null;
  let shaError: string | null = null;
  let remoteVersion: string | null = null;
  let targetTag: string | null = null;
  try {
    const release = await fetchGithubLatestRelease(opts.repo);
    if (release) {
      targetTag = release.tag;
      remoteVersion = release.version;
      remoteRevision = release.sha;
    }
  } catch (error) {
    shaError = error instanceof Error ? error.message : String(error);
  }
  if (!remoteRevision && !remoteVersion) {
    try {
      remoteRevision = await fetchGithubCommitSha(opts.repo, targetTag ?? opts.branch);
    } catch (error) {
      shaError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!remoteVersion) {
    try {
      remoteVersion = await fetchGithubPackageVersion(opts.repo, remoteRevision ?? targetTag ?? opts.branch);
    } catch {
      remoteVersion = null;
    }
  }

  const targetVersion = selfUpdateTargetVersion(APP_VERSION, remoteVersion, sourceVersion);
  const updateAvailable = isSelfUpdateAvailable({
    runningVersion: APP_VERSION,
    sourceVersion,
    remoteVersion,
  });

  let changelog: string | null = null;
  if (updateAvailable) {
    try {
      changelog = await fetchGithubChangelog(opts.repo, targetTag ?? remoteRevision ?? opts.branch, APP_VERSION);
    } catch {
      changelog = null;
    }
  }

  return withProgress({
    ...base,
    remoteVersion,
    remoteRevision,
    targetTag,
    updateAvailable,
    targetVersion,
    changelog,
    message: selfUpdateReadyMessage({
      updating,
      updateAvailable,
      currentVersion: APP_VERSION,
      targetVersion,
      shaError,
    }),
  });
}

async function withProgress(status: SelfUpdateStatus): Promise<SelfUpdateStatus> {
  const progress = readProgressFromDir(progressDir());
  return { ...status, progress: status.updating || progress?.step === "error" ? progress : progress };
}

export async function applySelfUpdate(): Promise<{ ok: boolean; message: string; mode: SelfUpdateMode }> {
  if (applyInFlight || isUpdaterRunning()) {
    return { ok: false, message: "Update läuft bereits", mode: resolveSelfUpdateMode(true) };
  }
  const status = await getSelfUpdateStatus();
  if (!status.enabled) return { ok: false, message: status.message, mode: status.mode };
  if (!status.updateAvailable) {
    return { ok: false, message: status.message, mode: status.mode };
  }

  const installDir = options().installDir;
  if (!installDir) {
    return { ok: false, message: "CLOUDORA_INSTALL_DIR ist nicht gesetzt", mode: "native" };
  }

  applyInFlight = true;
  try {
    return await applyOnHost(installDir, options().repo, options().branch, status.targetTag);
  } finally {
    applyInFlight = false;
  }
}

async function applyOnHost(installMount: string, repo: string, branch: string, tag: string | null) {
  const scriptPath = path.join(installMount, "scripts", "self-update-apply.sh");
  if (!existsSync(scriptPath)) {
    return { ok: false, message: "self-update-apply.sh fehlt", mode: "native" as const };
  }
  try {
    const { stdout, stderr } = await execFileAsync("sh", [scriptPath], {
      env: {
        ...process.env,
        CLOUDORA_INSTALL_DIR: installMount,
        CLOUDORA_REPO: repo,
        CLOUDORA_BRANCH: branch,
        CLOUDORA_RELEASE_TAG: tag ?? "",
      },
      timeout: APPLY_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-8).join("\n");
    return { ok: true, mode: "native" as const, message: `Dateien synchronisiert.\n${tail}` };
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return {
      ok: false,
      mode: "native" as const,
      message: [err.message, err.stderr, err.stdout].filter(Boolean).join("\n") || String(error),
    };
  }
}
