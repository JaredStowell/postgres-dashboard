# Index Analyzer Implementation Plan

## Goal

Build a complete, polished PostgreSQL observability and tuning workbench as a vinext application that runs locally against PostgreSQL and is production-shaped for Cloudflare Workers, Hyperdrive, and PlanetScale Postgres. The application will let an operator move from fleet-level health to a specific query, understand its history and execution plan, inspect relevant tables and indexes, identify maintenance and contention risks, request a privacy-conscious AI analysis, and preserve findings over time.

Deployment itself is intentionally excluded from this plan because the user will participate in Cloudflare and PlanetScale provisioning. Everything required before deployment—application code, Worker and Hyperdrive configuration templates, migrations, local database, fixtures, capability detection, documentation, and verification—must be complete.

## Product principles

1. **Evidence before advice.** Every recommendation must point to catalog data, statistics, a plan node, or a measured delta.
2. **Fresh operational data.** Target Hyperdrive bindings are cache-disabled; live database state must never silently use cached reads.
3. **Inspection first.** The application never exposes a generic SQL execution API and never automatically runs generated migration SQL.
4. **Safe analysis.** Plain `EXPLAIN` is the default. `EXPLAIN ANALYZE` is a separately guarded, read-only, time-limited operation with explicit confirmation.
5. **Capability-aware behavior.** PostgreSQL version, extensions, privileges, and view availability are detected per database and reflected in the UI.
6. **All schemas, explicit databases.** Schemas are discovered automatically. Each fully inspected database is represented by an explicit target connection/Hyperdrive binding.
7. **Performance is a feature.** Large tables are paginated or virtualized, heavy visualizations are lazy-loaded, catalog queries are bounded, and regression/performance tests are part of completion.
8. **Privacy by design.** AI payloads exclude result rows, redact literals by default, are previewable, use structured outputs, and opt out of response storage.
9. **Dark, clean, and vivid.** The visual system is dark-first with restrained surfaces, crisp typography, and bright cyan, violet, amber, green, and rose accents used for meaning and contrast.

## Architecture

- **Web application:** vinext App Router, React, TypeScript, server components, route handlers, and focused client islands.
- **Deployment runtime:** Cloudflare Workers with `nodejs_compat` and native `cloudflare:workers` binding access.
- **Database driver:** `pg`; catalog and diagnostic SQL remain explicit and typed.
- **Control database:** an `index_analyzer` schema stores target metadata, snapshots, plans, AI analyses, findings, rules, and audit events.
- **Target databases:** read-only PostgreSQL connections selected through named Hyperdrive bindings. No credentials are stored in application tables.
- **Collection:** a scheduled collector entry point snapshots cumulative statistics and records reset boundaries. The same collector is directly invokable in local tests.
- **AI:** OpenAI Node SDK, Responses API, `responses.parse()`, Zod structured output, `store: false`, configurable balanced/deep models.
- **Local environment:** Docker Compose PostgreSQL with `pg_stat_statements`, multiple schemas, realistic fixtures, intentionally inefficient queries/indexes, and repeatable workload generation.

## User experience and navigation

### Application shell

- Responsive dark application frame with compact sidebar, target/database/schema selector, collection freshness indicator, capability status, global command/search trigger, and contextual actions.
- Accessible focus treatment, keyboard navigation, tooltips, empty states, skeletons, error boundaries, and reduced-motion behavior.
- Desktop-first data density with usable tablet/mobile fallbacks.

### Fleet

- Cross-target/database health cards and score.
- Query latency/call deltas, cache hit ratio, active sessions, blocked sessions, dead tuples, index footprint, vacuum/freeze risk, and collection freshness.
- Trend charts based on stored snapshots.
- Prioritized findings stream with severity, evidence, status, and destination links.
- Capability matrix showing available extensions, privileges, and degraded features.

### Queries

- Paginated and filterable `pg_stat_statements` inventory.
- Sort by total/mean execution time, calls, rows, planning time, temporary I/O, shared-block activity, WAL, and interval deltas when supported.
- Search across normalized query text, query ID, database, user, and schema hints.
- Query detail drawer/page with trend history, reset-aware deltas, plan history, related findings, and table/index context.
- Regression detection comparing recent snapshot windows against a baseline, with configurable thresholds and minimum-call guards.

### Plans / EXPLAIN Lab

- SQL editor with parameter input and database/schema context.
- Plain `EXPLAIN (FORMAT JSON, SETTINGS, VERBOSE)` flow.
- Explicitly confirmed `EXPLAIN ANALYZE` flow restricted to a single read-only statement and wrapped in a read-only transaction with statement, lock, and idle transaction timeouts.
- Interactive plan tree and detail inspector.
- Highlights for dominant cost/time nodes, sequential scans, spills/sorts, nested-loop amplification, row-estimate errors, filter rejection, buffer pressure, WAL, parallelism, and JIT when present.
- Persisted plan runs and side-by-side plan diff with node matching and material changes.
- Shareable, sanitized report export as JSON and Markdown.

### Indexes

- Inventory with definition, method, validity, uniqueness, size, scans, tuples read/fetched, and owning table.
- Duplicate, exact-equivalent, prefix-overlap, invalid, and unused-index candidates.
- Write-cost signal based on table mutation volume, index count, and index size.
- Evidence-backed missing-index candidates derived from plan nodes and workload patterns.
- Capability-gated hypothetical-index integration contract; when unsupported, the UI explains the limitation instead of fabricating a simulated result.
- Recommendation detail and review-only `CREATE INDEX CONCURRENTLY` migration generation.

### Maintenance

- Table inventory with estimated/live/dead rows, relation and total size, sequential/index activity, modification counts, last vacuum/autovacuum/analyze/autoanalyze, and per-table settings.
- Vacuum urgency, analyze staleness, freeze-age, and bloat-risk scoring.
- Live vacuum/analyze/index-build progress when available.
- Capability-gated `pgstattuple` exact checks with explicit cost warning and bounded execution.
- Maintenance findings and review-only command generation.

### Live Activity

- `pg_stat_activity` sessions, waits, transaction age, query age, application/client identity, and state.
- Blocking graph built with `pg_blocking_pids()` and lock evidence.
- Long-running and idle-in-transaction detection.
- Filters and auto-refresh with a visible pause control.
- No terminate/cancel controls in this implementation; action suggestions remain copy-only.

### AI Advisor

- AI action available from a query, plan, index candidate, or finding.
- Payload preview shows the exact normalized query, sanitized plan, schema metadata, index definitions, statistics, and settings to be transmitted.
- Default literal/comment redaction, no result rows, request size limits, and visible privacy warning.
- Structured response with summary, severity, confidence, evidence, caveats, recommendations, validation steps, and optional migration SQL.
- Balanced and deep analysis modes driven by environment-configurable model names.
- Saved analyses, token/request metadata when returned, request IDs, error states, retry, and related findings.
- AI output is advisory; generated SQL can only be copied or exported.

### Alerts and findings

- Rules for query regression, long transactions, blocked sessions, dead tuple ratio, vacuum/analyze staleness, freeze risk, unused/duplicate indexes, and plan changes.
- Findings have severity, evidence, first/last seen timestamps, occurrence count, open/acknowledged/resolved/dismissed status, and optional notes.
- Repeated collection deduplicates findings by a stable fingerprint.

## Database and migration plan

Create ordered, reversible-minded SQL migrations:

1. `0001_control_plane.sql`: schema, migration ledger, sources, source databases, capabilities, collection runs.
2. `0002_observability_history.sql`: query, table, index, database, and activity snapshots with reset markers and retention-friendly indexes.
3. `0003_plans.sql`: explain runs, plan JSON, sanitized exports, plan comparisons.
4. `0004_findings.sql`: rules, findings, evidence, status history, annotations.
5. `0005_ai_advisor.sql`: analysis requests/results, payload digests, model/request metadata, recommendations.
6. `0006_alert_rule_expansion.sql`: configurable thresholds and seeded rules for maintenance, contention, index, and plan-change findings.

Migrations must be idempotently tracked, run through a repository script, and be covered by integration tests. The local database initialization separately enables extensions and creates fixture schemas; application migrations do not mutate monitored schemas.

## Database access and safety

- Validate source keys against a compiled binding registry; never derive an environment property or identifier directly from user input.
- Parameterize values and safely quote capability-discovered identifiers.
- Apply pagination and maximum row limits to all inventory endpoints.
- Use dedicated query modules for catalog, workload, maintenance, activity, plans, and control-plane persistence.
- Detect `pg_stat_statements`, `pgstattuple`, server version, recovery state, privileges, tracking settings, and supported columns.
- Query text from other roles requires `pg_read_all_stats`; missing access is surfaced as a capability warning.
- Reject multi-statement EXPLAIN input and prohibited statement classes.
- `EXPLAIN ANALYZE` uses an explicit confirmation token, read-only transaction, bounded timeouts, and rollback.
- AI routes require an API key only on the server and never serialize it to the client.
- Secrets, connection strings, and raw credentials never enter logs, snapshots, exports, or the control database.

## Visual design

- Near-black navy background with subtly lighter elevated surfaces.
- Cyan primary accent, violet secondary accent, green success, amber warning, rose critical.
- Fine borders, soft radial glows, restrained shadows, compact radii, monospaced numeric/query treatment, and high-contrast readable body text.
- Charts use accessible palettes and never rely on color alone.
- Status chips, mini sparklines, plan-node heat, and finding severity use consistent semantic tokens.
- Motion is brief and functional; reduced-motion disables transitions.

## Testing and verification

### Unit tests

- Snapshot delta/reset math and regression scoring.
- Query redaction, payload limits, SQL statement classification, identifier quoting, and confirmation tokens.
- Plan traversal, metrics, warnings, node matching, and diff generation.
- Duplicate/prefix index analysis, write-cost signals, maintenance scores, finding fingerprints, and capability degradation.
- AI structured schema and prompt/payload construction.
- UI formatters and critical components.

### PostgreSQL integration tests

- Apply every migration to a fresh database and re-run safely.
- Query real `pg_stat_statements`, catalogs, indexes, maintenance views, activity/locks, and capability detection.
- Verify multi-schema discovery.
- Prove plain EXPLAIN works and guarded ANALYZE rejects writes/multiple statements, honors read-only behavior, and rolls back.
- Snapshot collection, reset boundaries, finding deduplication, plan persistence, and retention indexes.

### Application tests

- Route handler validation, error mapping, pagination, unavailable capability behavior, and AI-disabled behavior.
- React component tests for the shell, tables, filters, plan tree, diff, payload preview, and findings.
- Playwright flows across every tab using deterministic fixture data and the real local PostgreSQL service.
- Accessibility scan for primary pages and keyboard navigation.

### Worker and performance verification

- Type checking, linting, formatting, vinext compatibility check, production build, and Wrangler dry run.
- Run the production Worker locally and execute smoke tests.
- Bundle-size report and route-level performance budget.
- API/load benchmark for high-cardinality query/index inventories with latency and memory results recorded.
- Ensure heavy client modules are split and initial dashboard payloads are bounded.

## Implementation phases

1. **Foundation:** initialize `main`, scaffold vinext, establish design system, app shell, configuration, Docker Postgres, migrations, and test harness.
2. **Data layer:** binding registry, typed PostgreSQL clients, capability detection, catalog/stat modules, control-plane repositories, collector, fixtures, and integration tests.
3. **Core UI:** Fleet, Queries, Indexes, Maintenance, and Live Activity with real local data and responsive states.
4. **Plan Lab:** safe EXPLAIN endpoints, editor, plan analysis/tree, history, diff, and exports.
5. **Findings:** rule engine, regression detection, plan-change detection, deduplication, statuses, and cross-product navigation.
6. **AI Advisor:** payload redaction/preview, OpenAI structured response path, persistence, analysis history, and disabled/mock modes.
7. **Hardening:** capability degradation, security review, accessibility, retention/limits, failure states, documentation, and exhaustive tests.
8. **Performance and release proof:** production build, Worker smoke, load/bundle benchmarks, final review, and closure of all plan acceptance criteria.

## Completion criteria

The implementation is done only when:

- Every tab and fancy addition described above is present and connected to real local PostgreSQL data or an explicitly labeled capability-gated state.
- All six application migrations and the local fixture/bootstrap flow work from a clean checkout.
- Every database endpoint is bounded, validated, and tested.
- EXPLAIN and guarded EXPLAIN ANALYZE work with the documented safety controls.
- Snapshot history, deltas, regressions, plan diffs, alerts/findings, and sanitized exports work end to end.
- AI payload preview, redaction, structured analysis, persistence, and no-key/mock behavior work end to end.
- The dark visual system is coherent, responsive, accessible, and visually verified.
- Unit, integration, component, route, Playwright, accessibility, Worker smoke, build, lint, type, and performance gates pass.
- Documentation explains local startup, migrations, fixture workload, test commands, architecture, security model, Cloudflare bindings, Hyperdrive cache requirements, PlanetScale prerequisites, and deployment handoff.
- The repository is committed and pushed when a remote is available. If no remote exists, commits are still created on `main` and the missing push destination is reported honestly.
- Cloud deployment is the only intentionally unfinished step.

## Completion record

Implementation completed on 2026-07-13 with deployment intentionally deferred. The finished application includes all eight workspaces, six migrations, local PostgreSQL fixtures, a scheduled and directly invokable collector, structured OpenAI Advisor integration, capability-gated HypoPG and `pgstattuple` workflows, reset-aware histories, contextual findings, responsive/accessible UI states, and production-shaped Cloudflare Worker and Hyperdrive configuration.

Final verification evidence:

- Formatting, lint, TypeScript, 128 unit/component/route tests, and the vinext production build passed through `pnpm verify`.
- 53 PostgreSQL integration tests passed against fresh, migrated databases.
- 29 Playwright tests passed across desktop and mobile; one desktop-only duplicate of the mobile-navigation assertion was intentionally skipped. Accessibility scans covered every primary workspace with no serious or critical violations.
- `vinext check` reported 100% compatibility across 9 pages and 18 route handlers.
- Both Worker dry runs passed. The web Worker upload measured 4,196.23 KiB raw / 893.17 KiB gzip; the collector measured 290.52 KiB raw / 62.90 KiB gzip.
- The Workerd smoke test passed normal requests, 12 parallel requests, one canceled response stream, and a post-cancellation health request.
- Database inventory p95 latency measured 14.55 ms for queries, 11.76 ms for indexes, and 4.08 ms for maintenance.
- Synthetic 10,000-row inventory p95 latency measured 8.79 ms for queries and 9.56 ms for indexes.
- Route p95 latency remained below the 750 ms budget; the slowest measured route was Fleet at 129.64 ms.
- Initial client JavaScript measured 122,856 bytes gzip against a 184,320-byte budget, the SQL editor remained lazy-loaded, and measured heap growth was 105,587,400 bytes against a 167,772,160-byte budget.
- The benchmark reported no budget failures, and CI uploads the generated performance and Worker smoke artifacts for durable inspection.
