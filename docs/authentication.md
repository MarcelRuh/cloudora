# Authentication

- Identifier: username **or** email (case-insensitive)
- Password: bcrypt (12 rounds), never stored in plaintext
- Session: 32-byte `base64url` token in an HttpOnly `SameSite=Lax` cookie (`cloudora_session`)
- Database stores only `sha256(token)`
- Expiry: `SESSION_DAYS` (default 7)
- Disabled users (`status=DISABLED`) cannot obtain a session
- Login rate limit: 8 attempts / 15 minutes per IP and per username, stored in PostgreSQL (in-memory fallback)
- Mutations check `Origin` / `Referer` against `PUBLIC_URL` and forwarded host (when `TRUST_PROXY=true`)
- TOTP (RFC 6238, SHA-1, 30s, ±1 step). Secret is AES-256-GCM encrypted at rest. Enable under **Einstellungen**.
