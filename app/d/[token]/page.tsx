import { PublicDownload } from "@/components/public/public-download";

export default async function PublicDPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicDownload token={token} kind="d" />;
}
