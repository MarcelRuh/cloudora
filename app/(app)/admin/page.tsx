import Link from "next/link";
import { AccessGuide } from "@/components/admin/access-guide";
import { Card } from "@/components/ui/card";

const LINKS = [
  { href: "/admin/users", title: "Benutzer", desc: "Konten, Rolle, Home, Quota, Konto-Rechte" },
  { href: "/admin/storage", title: "Speicher", desc: "Ordnerzugriff, Verbrauch, Homes" },
  { href: "/admin/links", title: "Links", desc: "Alle geteilten Links sperren oder löschen" },
  { href: "/admin/audit", title: "Audit-Log", desc: "Protokoll aller relevanten Aktionen" },
  { href: "/admin/system", title: "System", desc: "Version, Datenbank, Updates" },
];

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="cloudora-section">Administration</p>
        <h1 className="cloudora-title text-2xl">Übersicht</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          So richtest du Zugriff ein. Die drei Schritte in dieser Reihenfolge.
        </p>
      </div>
      <AccessGuide />
      <div>
        <p className="cloudora-section mb-3">Bereiche</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {LINKS.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="h-full">
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
