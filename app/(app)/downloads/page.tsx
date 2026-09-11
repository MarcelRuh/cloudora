import { LinkTable } from "@/components/admin/link-table";

export default function DownloadsPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Cloudora</p>
        <h1 className="cloudora-title text-2xl">One-Time-Downloads</h1>
      </div>
      <LinkTable kind="downloads" />
    </div>
  );
}
