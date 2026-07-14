# Cloudflare and PlanetScale Handoff

Deployment is intentionally completed with the repository owner. This document lists the required resources and commands without creating them.

## PlanetScale prerequisites

For every monitored branch/database:

1. Enable `pg_stat_statements` from the PlanetScale dashboard extension settings.
2. Apply the queued extension change and allow the required restart.
3. Connect to the database and run:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```

4. Create dedicated user-defined credentials for monitoring. Grant the minimum required table/catalog access and `pg_read_all_stats` when cross-role query text is required.
5. Optionally enable `pgstattuple` for explicit exact-bloat checks.

Use the direct PostgreSQL endpoint when creating Hyperdrive configurations; Hyperdrive supplies its own connection pooling.

## Hyperdrive resources

Create one cache-disabled configuration for the control database and one for every fully inspected target database:

```bash
npx wrangler hyperdrive create index-analyzer-control \
  --connection-string="postgres://..." \
  --caching-disabled

npx wrangler hyperdrive create index-analyzer-production \
  --connection-string="postgres://..." \
  --caching-disabled
```

Replace the placeholder IDs in `wrangler.jsonc`, add additional target bindings, and update `INDEX_ANALYZER_TARGETS`.

Never use Hyperdrive's default query caching for diagnostic bindings. Freshness is part of the application's correctness contract.

## Worker secrets and variables

```bash
npx wrangler secret put OPENAI_API_KEY
```

Set the balanced and deep model names as Worker variables. Keep AI mock mode disabled in production.

## Access control

Create a Cloudflare Access application covering the Worker custom domain before inviting operators. Restrict it to the intended identity provider groups and verify that unauthenticated requests cannot reach application routes.

## Pre-deployment verification

```bash
pnpm db:setup
pnpm verify
pnpm test:integration
pnpm test:e2e
pnpm vinext:check
pnpm deploy:dry
pnpm benchmark
```

Review the generated bundle, Wrangler binding summary, capability matrix against the real PlanetScale role, and sanitized AI payload before the first production deployment.

## Deployment

After replacing resource IDs and authenticating Wrangler:

```bash
npx @vinext/cloudflare deploy
```

Run the post-deployment smoke flow against the protected custom domain: Fleet, Queries, plain EXPLAIN, guarded ANALYZE on a harmless query, Indexes, Maintenance, Live, collection, and an AI analysis.

