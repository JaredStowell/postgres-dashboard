# Index Analyzer

Index Analyzer is a dark, evidence-first PostgreSQL observability and tuning workbench built with vinext for Cloudflare Workers. It combines workload history, interactive query plans, index and maintenance diagnostics, live contention analysis, findings, and privacy-conscious AI advice.

The repository is production-shaped for Cloudflare Hyperdrive and PlanetScale Postgres, while remaining fully runnable against the included local PostgreSQL service.

## What it includes

- Fleet health across configured PostgreSQL databases
- Reset-aware `pg_stat_statements` history and query regression detection
- Safe EXPLAIN Lab with JSON plan visualization and plan diffs
- Index inventory, overlap detection, write-cost signals, and migration suggestions
- Vacuum, analyze, freeze, and bloat-risk analysis
- Live activity, waits, long transactions, and blocking graphs
- Durable, deduplicated findings and alert rules
- OpenAI Responses API analysis with structured output and payload preview
- Capability detection for versions, extensions, views, settings, and privileges

The detailed acceptance contract lives in [PLAN.md](./PLAN.md).

## Requirements

- Node.js 24 or newer
- pnpm 11
- Docker Desktop or a compatible Docker runtime

## Local quick start

```bash
cp .env.example .env
pnpm install
pnpm db:setup
pnpm dev
```

Open `http://127.0.0.1:3000`. The local service listens on PostgreSQL port `55432` and contains multiple fixture schemas, workload history, useful and deliberately problematic indexes, and activity suitable for exercising the dashboard.

To reset the local environment:

```bash
pnpm db:down
docker compose down --volumes
pnpm db:setup
```

## Useful commands

```bash
pnpm db:migrate          # apply application migrations
pnpm db:seed             # install/reload fixture workload
pnpm collect             # run one snapshot collection
pnpm test                # unit and component tests
pnpm test:integration    # tests against the local PostgreSQL service
pnpm test:e2e            # Chromium and mobile product flows
pnpm vinext:check        # vinext compatibility scan
pnpm build               # production build
pnpm deploy:dry          # Cloudflare packaging dry run; no deployment
pnpm benchmark           # bounded inventory API/load benchmark
pnpm verify              # formatting, lint, types, unit tests, and build
```

## Target configuration

`INDEX_ANALYZER_TARGETS` is a comma-separated registry:

```text
source-key:Human label:BINDING_NAME,another:Another database:TARGET_ANOTHER
```

In local Node execution, a binding can be a connection-string environment variable. In Workers it is a Hyperdrive binding with a `connectionString` property. Source keys are allowlisted from this registry; request data can never select an arbitrary environment property or connection string.

Each fully inspected PostgreSQL database needs its own binding. Schemas inside that database are discovered automatically. The application stores only symbolic source keys and binding names—never target credentials.

## OpenAI configuration

The AI Advisor is disabled unless either `AI_MOCK_MODE=true` or `OPENAI_API_KEY` is available to the server runtime.

```text
OPENAI_API_KEY=...
OPENAI_BALANCED_MODEL=gpt-5.6-terra
OPENAI_DEEP_MODEL=gpt-5.6-sol
AI_MOCK_MODE=false
```

For Workers, create the key as a secret rather than a Wrangler variable:

```bash
npx wrangler secret put OPENAI_API_KEY
```

AI payloads contain no result rows, redact literals/comments by default, have a strict size cap, are shown to the operator before submission, and use `store: false`. Suggested SQL is review-only.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Security model](./docs/SECURITY.md)
- [Cloudflare and PlanetScale handoff](./docs/DEPLOYMENT.md)
- [Implementation plan](./PLAN.md)

## Project status

Local implementation and verification are owned by this repository. Cloudflare and PlanetScale resource creation and the final production deployment are intentionally completed with the repository owner.

