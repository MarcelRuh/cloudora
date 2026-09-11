import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { FileExplorer } from "@/components/explorer/file-explorer";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = await searchParams;
  const path = params.path ?? "/";
  return <FileExplorer user={user} initialPath={path} />;
}
