# ONE Cloudflare API

This directory is the first server-backed API foundation for ONE. It uses Cloudflare Workers, D1 and a private R2 bucket. The web and Capacitor clients will call this API instead of treating browser storage as the source of truth.

## Required Cloudflare resources

Create these resources in the Cloudflare account that owns the current `workers.dev` deployment:

- Worker: `one-api`
- D1 database: `one-production`
- Private R2 bucket: `one-private-media`

Update `wrangler.jsonc` with the real D1 database ID. Do not make the media bucket public.

## Authentication is intentionally fail-closed

The API requires an OIDC-compatible identity provider that issues RS256 or ES256 JWTs. Configure Worker secrets/vars:

- `AUTH_ISSUER`: exact JWT issuer URL
- `AUTH_AUDIENCE`: expected audience
- `AUTH_JWKS_URL`: provider's JWKS endpoint
- `APP_ORIGINS`: comma-separated allowed web origins, including Capacitor origins

No local/demo identity fallback exists. Requests without a valid bearer token receive HTTP 401. Choose and configure the production identity provider before connecting signup/login in the app.

## Local development

From this directory:

```sh
npm install
npx wrangler d1 migrations apply one-production --local
npm run dev
```

For a remote D1 database, use `--remote` only after the production account and database have been confirmed.

## API routes in this foundation

- `GET /api/health`
- `GET /api/me`
- `GET, PUT /api/profile`
- `GET /api/discover`
- `POST /api/likes`
- `GET /api/matches`
- `GET, POST /api/conversations/:id/messages`
- `POST /api/blocks`
- `POST /api/reports`

Messages are persisted server-side; realtime delivery, read receipts, push notifications, moderation operations, private photo upload/delivery, and payment webhooks are follow-on integrations and must be completed before public launch.

## Security and launch gates

- Use a managed consumer identity provider; do not build password storage in this Worker.
- Keep R2 private and deliver media only through authenticated, authorization-checked handlers.
- Add per-user/IP rate limits and abuse controls before public exposure.
- Add data export/deletion, consent records, privacy retention, moderation queues, and audit logs.
- Implement payment provider webhooks with signature verification and idempotency; never trust client payment status.
- Validate age and profile data server-side. The date-of-birth check here is a minimum age gate, not identity or age verification.
- Complete security, GDPR, consumer/payment, App Store and Play policy reviews before accepting real users.

This API foundation is not yet a production launch. It must be configured, tested, connected to the mobile client, and deployed to the intended Cloudflare account.
