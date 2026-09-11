# Development

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Default login after seed: `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`.

Useful scripts:

- `npm run test` – vitest (path jail, auth hash, quota, RBAC, tokens)
- `npm run typecheck`
- `npm run lint`

Keep new file operations inside `server/services/file-service.ts` so the jail cannot be bypassed by a new route.
