# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Write protection

The deployed site does not require visitors to have an account. Read-only pages
are public, and on-site single-record submissions are protected by Cloudflare
Turnstile.

Administrative writes use a server-side site password plus Cloudflare rate
limiting:

- Excel batch imports and correction versions use `ADMIN_PASSWORD` when set.
- For compatibility with existing deployments, they fall back to
  `DELETE_PASSWORD` when `ADMIN_PASSWORD` is absent.
- Permanent deletion and device axle-profile changes continue to use
  `DELETE_PASSWORD`.

Configure hosted secrets in the hosting environment, not in the repository.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
