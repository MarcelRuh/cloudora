# Changelog

## 1.3.13 – 2026-09-18

- Nur noch native systemd: Docker Compose, Sidecar und `/host`-Browse entfernt
- Path-Picker prüft den echten Host-Pfad; „nicht beschreibbar“ nur noch bei fehlendem OS-Schreibrecht
- Docker-`.env` mit `CLOUDORA_STORAGE_PATH=/storage` nutzt `CLOUDORA_HOST_STORAGE`, falls das ein Host-Pfad ist

## 1.3.12 – 2026-09-15

- Administration → Links: alle öffentlichen und Einmal-Links aller Benutzer sperren oder restlos löschen

## 1.3.11 – 2026-09-15

- Große Downloads (ISO) nicht mehr nach wenigen Minuten abbrechen: HTTP-Range, kein 5-Minuten-Node-Timeout
- Chrome kann unterbrochene Downloads fortsetzen; Range zählt nicht extra gegen Einmal-Links

## 1.3.10 – 2026-09-15

- Öffentliche Links: Passwort nur einmal, danach Cookie; Ordnerwechsel ohne erneute Eingabe
- Rate-Limit nur bei falschem Passwort, nicht beim Blättern oder Download
- Große Dateien (z. B. ISO) per Browser-Download, nicht über den Arbeitsspeicher

## 1.3.9 – 2026-09-15

- Zugriff klar getrennt: Konto (Benutzer) → Ordnerzugriff (Speicher) → Link nach draußen (Explorer)
- Navigation „Links“ statt „Freigaben“; Einmal-Links auf derselben Seite
- Speicher öffnet mit Ordnerzugriff; Explorer-Aktionen „Link teilen“ und „Einmal-Link“

## 1.3.8 – 2026-09-12

- Globale Suche nutzt den Datei-Index (sichtbare Freigaben), kein Dateibaum-Walk mehr
- Self-Update unterscheidet Native (systemd) und Docker; UI und Docs ohne Compose-Default

## 1.3.7 – 2026-09-12

- Upload überschreibt nicht mehr still: gleicher Name wird zu `datei (1).ext`
- Öffentliche Freigaben und One-Time-Downloads mit Rate-Limit gegen Passwort-Brute-Force
- ZIP-Download von Ordnern mit Limit (Dateien und Größe)
- Quota gilt für Home + Papierkorb, nicht für Ordnerfreigaben; Prüfung gegen die Datenbank
- CSRF verlangt Origin/Referer; Sitzungstokens mit HMAC über `SESSION_SECRET`
- Health prüft Datenbank und Storage; DB-Backup als Stream ohne RAM-Puffer
- Große Uploads: längere Route-Laufzeit und automatischer Retry bei Netzfehlern

## 1.3.6 – 2026-09-12

- Download puffert große Dateien nicht mehr komplett im Browser (kein „Netzwerkfehler“)
- Dateistreams ohne gzip, damit Content-Length stimmt

## 1.3.5 – 2026-09-12

- Upload/Download-Fortschritt in der Sidebar, einklappbar, mit Prozent und Speed

## 1.3.4 – 2026-09-12

- Upload und Download mit Fortschrittsbalken, Prozent und aktueller Geschwindigkeit

## 1.3.3 – 2026-09-12

- Explorer: Zurück/Vor/Ordner hoch, Suche, Aktionen immer sichtbar (ausgegraut wenn nicht nutzbar)
- Home und Freigaben sind nicht löschbar, nur ihr Inhalt
- Host-Pfade nur für Administratoren, Benutzer sehen nur Namen

## 1.3.2 – 2026-09-12

- Explorer bricht nicht mehr ab, wenn Home oder eine Freigabe auf der Platte noch nicht existiert
- Home-Ordner unter `/mnt` werden im Native-Betrieb angelegt

## 1.3.1 – 2026-09-12

- Ordnerrechte auf Unterordner ohne Elternzugriff (z. B. `shared/test`, nicht `shared`)
- Schnellfreigabe: Benutzer, Ordner, Lesen/Schreiben
- Irreführende Host-Pfad-Hinweise im Path-Picker entfernt

## 1.3.0 – 2026-09-12

- Native-Betrieb (Node + PostgreSQL + systemd) statt Docker als Standard
- Samba-ähnliche Ordnerfreigaben mit Lesen/Schreiben je Rolle oder Benutzer
- Explorer zeigt nur konfigurierte Freigaben (plus Home), nicht mehr automatisch `/mnt`, `/media`, `/srv`

## 1.2.7 – 2026-09-11

- Extra-Volumes entfernt. `/mnt` (sowie `/media` und `/srv`) sind fest im Container und im Explorer
- Kein `docker-compose.cloudora-volumes.yml` mehr

## 1.2.6 – 2026-09-11

- Ordner im Path-Picker über den echten Host-Mount anlegen, nicht über das read-only-`/host`
- Speicherübersicht zeigt Kapazität, Belegung und freien Platz per Datenträger (`statfs`), kein Dateibaum-Walk
- `/mnt`, `/media` und `/srv` sind im Container schreibbar; Extra-Volumes darunter brauchen keinen Compose-Neustart

## 1.2.5 – 2026-09-11

- Host-Ordner sind mount-agnostisch: NFS, USB, ZFS, Bind, LXC — der Host-Pfad ist die Identität, der Name kommt vom letzten Pfadteil wenn leer
- Administration und Explorer sprechen von Host-Ordnern, nicht von einem bestimmten Hypervisor

## 1.2.4 – 2026-09-11

- Host-Datenträger im Explorer mit Platten-Icon, Badge und Banner (Name + Host-Pfad für Admins)
- Administration → Speicher listet Extra-Volumes als Host-Datenträger, nicht als normalen Ordner

## 1.2.3 – 2026-09-11

- `CLOUDORA_HOST_STORAGE` (z. B. Proxmox-Mount `/mnt/cloudora`) ist das Docker-Volume — nicht nochmal als Extra-Volume linken
- Sidecar startet bei Volume-Änderungen nur den App-Container, nicht sich selbst (kein Absturz mehr in Created)
- Picker erkennt den Host-Bind als beschreibbares Volume

## 1.2.2 – 2026-09-11

- Host-Ordner in Standard-Pfaden (z. B. `/mnt/clustern`) werden beim Speichern als schreibbares Volume gelinkt
- Path-Status unterscheidet Host-Browse (`/host`, nur lesen) von gemounteten Volumes
- Shared/Users außerhalb des Docker-Volumes laufen über `/storage/volumes/…`, nicht über das Read-only-`/host`

## 1.2.1 – 2026-09-11

- Mehrere Host-Ordner als Extra-Volumes linken (Administration → Speicher → Volumes)
- Path-Picker listet Linux `/` (Host-Wurzel über `/host`); Unterordner wählbar
- Sidecar übernimmt Bind-Mounts ohne Image-Rebuild

## 1.2.0 – 2026-09-11

- Self-Update in der UI (Administration → System): GitHub-Release holen, Stack neu bauen, Fortschritt
- Sidecar `cloudora-updater` mit `docker.sock`; die App selbst hat keinen Socket
- Erstes GitHub-Release (`v1.2.0`) als Basis für den Updater

## 1.1.1 – 2026-09-11

- QR-Code bei der TOTP-2FA-Einrichtung
- Öffentliche Ordner-Freigaben als ZIP herunterladen
- Papierkorb-Bereinigung stündlich im Hintergrund, nicht nur beim Öffnen des Papierkorbs
- Freier Speicher und Warnung unter Administration → System
- Dummy-Screenshots in der README

## 1.1.0 – 2026-09-11

- Papierkorb mit Wiederherstellen, endgültigem Löschen und automatischer 30-Tage-Bereinigung
- TOTP-2FA (Einrichtung, Login-Schritt, Deaktivieren) ohne Extra-Dependencies
- Sitzungen in den Einstellungen beenden (einzeln oder alle anderen)
- Login-Rate-Limit persistent in PostgreSQL statt nur im RAM
- Speicherlimit in der Benutzerverwaltung als MB/GB statt Roh-Bytes
- Video- und Audio-Vorschau inkl. HTTP-Range
- Freigaben mit Bearbeiten (Ordner listen, Vorschau, Upload) und Ordner-Links
- Datenbank-Backup (`pg_dump`) unter Administration → System

## 1.0.0 – 2026-09-11

Initial public release of **Cloudora**:

- Auth, RBAC, home-path jail, explorer, upload/download
- Formator editor, previews, one-time downloads, shares
- Dashboard, admin users, quotas, audit log, system view
- Docker Compose, NPM-ready reverse-proxy headers
