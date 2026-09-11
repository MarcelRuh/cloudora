# Changelog

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
