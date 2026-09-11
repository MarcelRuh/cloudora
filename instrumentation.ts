export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTrashPurgeJob } = await import("@/server/jobs/trash-purge");
  startTrashPurgeJob();
}
