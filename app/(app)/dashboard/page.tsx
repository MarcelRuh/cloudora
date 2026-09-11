import { getSession } from "@/server/auth/session";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <DashboardView user={user} />;
}
