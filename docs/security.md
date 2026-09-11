# Security

Report vulnerabilities privately to the maintainer. Do not open public issues with exploit details.

Hardening in v1:

- Path traversal rejected (`..`, null bytes, schemes, symlink jail break)
- RBAC + per-user capability flags
- bcrypt passwords, hashed session and one-time tokens
- TOTP secrets encrypted at rest (`ENCRYPTION_KEY`)
- Rate-limited login
- Origin CSRF check
- Quota and `MAX_UPLOAD_BYTES`
- Streamed downloads (no full-file RAM buffer on the server)
- `Content-Disposition` + `nosniff` (+ CSP sandbox on previews)
- SVG/PDF preview is served as files, not executed as HTML
- Prisma parameterized queries

The API is untrusted. A caller who sends `?path=../../../../etc/passwd` receives `PATH_TRAVERSAL`.
