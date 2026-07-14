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
npx wrangler secret put EXPLAIN_CONFIRMATION_SECRET
npx wrangler secret put OPENAI_API_KEY
```

Generate the EXPLAIN confirmation secret with at least 48 random bytes and paste
only the generated value into Wrangler's interactive prompt:

```bash
openssl rand -base64 48
```

Do not reuse the local development value. Before deployment, verify the secret
exists for the web Worker and that a guarded ANALYZE confirmation token issued
with an old secret is rejected after rotation.

Set the balanced and deep model names as Worker variables. Keep AI mock mode disabled in production.

The scheduled collector retains 14 days and at most 5,000 runs per database by
default. Tune `COLLECTION_RETENTION_DAYS` and `COLLECTION_MAX_RUNS` together for
the expected database count and collection frequency; both successful and
failed runs are pruned, with snapshot children removed by foreign-key cascade.

## Access control

Create a Cloudflare Access application covering the Worker custom domain before inviting operators. Restrict it to the intended identity provider groups and verify that unauthenticated requests cannot reach application routes.

## Pre-deployment verification

```bash
pnpm db:setup
pnpm verify
pnpm test:integration
pnpm test:e2e
pnpm vinext:check
pnpm smoke:worker
pnpm deploy:dry
pnpm collector:dry
pnpm benchmark
```

Review the generated bundle, Wrangler binding summary, capability matrix against the real PlanetScale role, and sanitized AI payload before the first production deployment.

## Deployment

After replacing resource IDs and authenticating Wrangler, build and deploy the
request-scoped web adapter. Do not point Wrangler directly at
`dist/server/index.js`; that bypasses the Hyperdrive pool lifecycle boundary.

```bash
pnpm build
npx wrangler deploy worker/web.mjs --assets dist/client --config wrangler.jsonc
npx wrangler deploy --config wrangler.collector.jsonc
```

Run the post-deployment smoke flow against the protected custom domain: Fleet, Queries, plain EXPLAIN, guarded ANALYZE on a harmless query, Indexes, Maintenance, Live, collection, and an AI analysis.
