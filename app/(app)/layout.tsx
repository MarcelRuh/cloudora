import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/server/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AppShell user={session}>{children}</AppShell>;
}
