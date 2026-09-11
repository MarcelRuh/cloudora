import { requirePermission } from "@/server/auth/require";
import { jsonError, jsonOk } from "@/server/http";
import { prisma } from "@/server/db";
import { queryParam } from "@/server/http-parse";

export async function GET(request: Request) {
  try {
    await requirePermission("audit.view");
    const url = new URL(request.url);
    const q = queryParam(url, "q");
    const action = queryParam(url, "action");
    const take = Math.min(Number(queryParam(url, "limit", "100")) || 100, 200);
    const items = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(q
          ? {
              OR: [
                { target: { contains: q, mode: "insensitive" } },
                { action: { contains: q, mode: "insensitive" } },
                { user: { username: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
    return jsonOk({
      items: items.map((row) => ({
        id: row.id,
        action: row.action,
        target: row.target,
        result: row.result,
        ip: row.ip,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        user: row.user?.displayName || row.user?.username || "System",
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
