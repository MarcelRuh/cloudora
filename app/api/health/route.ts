import { jsonOk } from "@/server/http";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export async function GET() {
  return jsonOk({ ok: true, app: APP_NAME, version: APP_VERSION });
}
