# Cloudora agent notes

- Product name is **Cloudora** everywhere (UI, cookies, docs).
- The in-app editor is **Formator**.
- Never send absolute storage paths to the client (except admin storage/share config).
- All file routes must call `resolveUserPath` / `file-service`.
- Explorer roots are configured **Ordnerfreigaben**, not auto-mounted `/mnt`.
- German UI copy; technical docs may be German or English.
- Stack: Next.js 16, Prisma 6, PostgreSQL 16, Tailwind 4. Native systemd only.
