import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { FormatorEditor } from "@/components/formator/formator-editor";

export default async function EditPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = await searchParams;
  const path = params.path ?? "";
  if (!path) redirect("/files");
  return <FormatorEditor path={path} />;
}
