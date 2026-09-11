import { requireSession } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http";
import { queryParam } from "@/server/http-parse";
import { searchFiles } from "@/server/services/file-service";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const url = new URL(request.url);
    const items = await searchFiles(user, queryParam(url, "q"), 40);
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
}
