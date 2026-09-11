import pino from "pino";
import { getEnv } from "@/server/env";

export const logger = pino({
  level: getEnv().logLevel,
  base: { app: "cloudora" },
  redact: ["req.headers.cookie", "password", "token", "SESSION_SECRET", "ENCRYPTION_KEY"],
});
