"use client";

import { AccessHint } from "@/components/admin/access-guide";
import { LinkTable } from "@/components/admin/link-table";

export function LinksHub({ manage = false }: { manage?: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="cloudora-section">{manage ? "Administration" : "Cloudora"}</p>
        <h1 className="cloudora-title text-2xl">Links</h1>
        <div className="mt-2 max-w-2xl space-y-2">
          <AccessHint />
          <p className="text-sm text-muted-foreground">
            {manage
              ? "Alle öffentlichen und Einmal-Links. Sperren macht den Token sofort ungültig. Löschen entfernt den Eintrag restlos aus der Datenbank."
              : "Neue Links entstehen im Datei-Explorer über Teilen. Hier siehst du deine URLs und kannst sie sperren."}
          </p>
        </div>
      </div>
      <section id="oeffentlich" className="space-y-2">
        <h2 className="text-sm font-semibold">Öffentliche Links</h2>
        <p className="text-xs text-muted-foreground">Mehrfach nutzbar, optional mit Passwort und Ablauf.</p>
        <LinkTable kind="shares" manage={manage} />
      </section>
      <section id="einmal" className="space-y-2">
        <h2 className="text-sm font-semibold">Einmal-Links</h2>
        <p className="text-xs text-muted-foreground">Begrenzte Downloads, typisch für eine einzelne Datei.</p>
        <LinkTable kind="downloads" manage={manage} />
      </section>
    </div>
  );
}
