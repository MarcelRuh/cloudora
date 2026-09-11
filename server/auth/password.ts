import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new Error("Passwort muss mindestens 8 Zeichen haben.");
  }
}
