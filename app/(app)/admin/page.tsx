import Link from "next/link";
import { Card } from "@/components/ui/card";

const LINKS = [
  { href: "/admin/users", title: "Benutzer", desc: "Konten, Rollen, Home-Pfade, Quotas" },
  { href: "/admin/storage", title: "Speicher", desc: "Verbrauch und Home-Verzeichnisse" },
  { href: "/admin/audit", title: "Audit-Log", desc: "Protokoll aller relevanten Aktionen" },
  { href: "/admin/system", title: "System", desc: "Version, Datenbank, Updates" },
  { href: "/shares", title: "Freigaben", desc: "Aktive Share-Links" },
  { href: "/downloads", title: "One-Time-Downloads", desc: "Temporäre Download-Tokens" },
];

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="cloudora-section">Administration</p>
        <h1 className="cloudora-title text-2xl">Übersicht</h1>
      </div>
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
  );
}
