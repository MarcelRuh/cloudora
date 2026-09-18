import { z } from "zod";
import { isAppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";
import { withPublicUnlock } from "@/server/auth/public-access";
import { clientIp, clientUserAgent, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import { inspectPublicDownload, consumePublicDownload, unlockPublicDownload } from "@/server/services/download-service";
import { nodeStreamResponse, streamBodyHeaders } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return jsonOk(await inspectPublicDownload(token));
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  password: z.string().optional(),
  unlock: z.boolean().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = await readJson(request, schema).catch(() => ({ password: undefined, unlock: false }));
    const ip = await clientIp();
    const ua = await clientUserAgent();
    return await withPublicUnlock("d", token, async (unlocked) => {
      if (body.unlock) {
        return jsonOk(await unlockPublicDownload(token, body.password, unlocked));
      }
      const result = await consumePublicDownload(token, body.password, ip, ua, unlocked);
      await writeAudit({
        ip,
        userAgent: ua,
        action: "OTD_USED",
        target: result.name,
      });
      return nodeStreamResponse(
        result.stream,
        streamBodyHeaders({
          mime: result.mime,
          fileName: result.name,
          disposition: "attachment",
          size: result.size,
        }),
      );
    });
  } catch (error) {
    if (isAppError(error) && error.code === "INVALID_PASSWORD") {
      await writeAudit({ ip: await clientIp(), action: "OTD_AUTH_FAILED", result: "FAILURE" });
    }
    return jsonError(error);
  }
}
