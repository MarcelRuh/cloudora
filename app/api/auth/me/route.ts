import { requireSession } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    const user = await requireSession();
    return jsonOk({ user });
  } catch (error) {
    return jsonError(error);
  }
}
