import { stat as fsStat } from "node:fs/promises";
import { writeAudit } from "@/server/audit";
import { publicFileQuery, withPublicUnlock } from "@/server/auth/public-access";
import { clientIp, jsonError } from "@/server/http";
import { consumePublicShare } from "@/server/services/share-service";
import { fileStreamResponse, isByteRangeResume, nodeStreamResponse, streamBodyHeaders } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

type Ctx = { params: Promise<{ token: string }> };

async function serve(request: Request, token: string) {
  const relative = publicFileQuery(new URL(request.url).searchParams.get("relative"));
  const resume = request.method === "HEAD" || isByteRangeResume(request);
  return withPublicUnlock("s", token, async (unlocked) => {
    const result = await consumePublicShare(token, undefined, relative, unlocked, !resume);
    if (request.method !== "HEAD" && !resume) {
      await writeAudit({ ip: await clientIp(), action: "SHARE_USED", target: result.name });
    }
    if (result.size != null && result.absPath) {
      const stat = await fsStat(result.absPath);
      if (stat.isFile()) {
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
      }
    }
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: streamBodyHeaders({
          mime: result.mime,
          fileName: result.name,
          disposition: "attachment",
          size: result.size,
        }),
      });
    }
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
