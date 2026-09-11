import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
