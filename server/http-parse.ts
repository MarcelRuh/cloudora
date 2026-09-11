import { z } from "zod";
import { AppError } from "@/lib/errors";

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Ungültiges JSON.", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Ungültige Eingabe.", 400, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

export function queryParam(url: URL, name: string, fallback = ""): string {
  return url.searchParams.get(name) ?? fallback;
}
