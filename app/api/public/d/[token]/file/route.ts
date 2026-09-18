import { stat as fsStat } from "node:fs/promises";
import { writeAudit } from "@/server/audit";
import { withPublicUnlock } from "@/server/auth/public-access";
import { clientIp, clientUserAgent, jsonError } from "@/server/http";
import { consumePublicDownload } from "@/server/services/download-service";
import { fileStreamResponse, isByteRangeResume, streamBodyHeaders } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

type Ctx = { params: Promise<{ token: string }> };

async function serve(request: Request, token: string) {
  const ip = await clientIp();
  const ua = await clientUserAgent();
  const resume = request.method === "HEAD" || isByteRangeResume(request);
  return withPublicUnlock("d", token, async (unlocked) => {
    const result = await consumePublicDownload(token, undefined, ip, ua, unlocked, !resume);
    if (request.method !== "HEAD" && !resume) {
      await writeAudit({ ip, userAgent: ua, action: "OTD_USED", target: result.name });
    }
    const stat = await fsStat(result.absPath);
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...streamBodyHeaders({
            mime: result.mime,
            fileName: result.name,
            disposition: "attachment",
            size: result.size,
            extra: { "Cache-Control": "no-store", "Accept-Ranges": "bytes" },
          }),
        },
      });
    }
    return fileStreamResponse(request, result.absPath, stat, result.mime, "attachment", result.name, {
      "Cache-Control": "no-store",
    });
  });
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return await serve(request, token);
  } catch (error) {
    return jsonError(error);
  }
}

export async function HEAD(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const res = await serve(request, token);
    return new Response(null, { status: res.status, headers: res.headers });
  } catch (error) {
    return jsonError(error);
  }
}
