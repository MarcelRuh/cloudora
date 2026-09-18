import { z } from "zod";
import { isAppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";
import { publicFileQuery, withPublicUnlock } from "@/server/auth/public-access";
import { clientIp, jsonError, jsonOk } from "@/server/http";
import { readJson } from "@/server/http-parse";
import {
  consumePublicShare,
  inspectPublicShare,
  listPublicShare,
  previewPublicShare,
} from "@/server/services/share-service";
import { fileStreamResponse, nodeStreamResponse, streamBodyHeaders } from "@/server/storage/http-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return jsonOk(await inspectPublicShare(token));
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  password: z.string().optional(),
  op: z.enum(["download", "list", "preview"]).optional(),
  relative: z.string().optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const body = await readJson(request, schema).catch(() => ({
      password: undefined,
      op: "download" as const,
      relative: "/",
    }));
    const op = body.op ?? "download";
    const relative = publicFileQuery(body.relative ?? "/");
    return await withPublicUnlock("s", token, async (unlocked) => {
      if (op === "list") {
        return jsonOk(await listPublicShare(token, body.password, relative, unlocked));
      }
      if (op === "preview") {
        const result = await previewPublicShare(token, body.password, relative, unlocked);
        return fileStreamResponse(request, result.absPath, result.stat, result.mime, "inline", result.name, {
          "Cache-Control": "no-store",
        });
      }
      const result = await consumePublicShare(token, body.password, relative, unlocked);
      await writeAudit({ ip: await clientIp(), action: "SHARE_USED", target: result.name });
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
      await writeAudit({ ip: await clientIp(), action: "SHARE_AUTH_FAILED", result: "FAILURE" });
    }
    return jsonError(error);
  }
}
