import { logger } from "@/server/logger";
import { purgeExpiredTrash } from "@/server/services/trash-service";

const INTERVAL_MS = 60 * 60 * 1000;

type GlobalWithJob = typeof globalThis & { __cloudoraTrashPurge?: boolean };

export function startTrashPurgeJob(): void {
  const g = globalThis as GlobalWithJob;
  if (g.__cloudoraTrashPurge) return;
  g.__cloudoraTrashPurge = true;
  const run = () => {
    void purgeExpiredTrash().catch((error) => {
      logger.warn({ err: error }, "trash purge failed");
    });
  };
  run();
  setInterval(run, INTERVAL_MS).unref();
}
