# Architecture

## Runtime topology

The user-facing application is a vinext App Router build running as a Cloudflare Worker. Server components and route handlers read bindings through the Worker environment. A scheduled collector uses the same diagnostic modules to persist snapshots into the control database.

There are two logical database roles:

1. **Control database:** owns the `index_analyzer` schema, migrations, histories, plans, findings, and AI analyses.
2. **Target databases:** monitored through named, read-only Hyperdrive bindings. A target is never inferred from a user-supplied connection string.

The control and target database may be the same PostgreSQL database for a small installation, but the code keeps their responsibilities separate.

## Request path

1. The route validates source key, database context, paging, filters, and feature-specific input.
2. The target registry resolves the source key to a compiled binding.
3. Capability detection selects the supported query shape for the server version and permissions.
4. A bounded catalog query executes through `pg` and Hyperdrive.
5. The route maps database types into a stable response contract.
6. Client tables and visualizations render only the requested page or summary.

## Collection and deltas

PostgreSQL exposes cumulative counters. The collector writes source/database snapshots with the associated statistics reset timestamp. Delta calculation rejects windows that cross a reset, contain decreasing counters, or have invalid timestamps. Regressions require both a material ratio change and a minimum call count to avoid noisy findings.

Collection is idempotent at the run level and findings are deduplicated by a stable resource/rule fingerprint. Repeated evidence updates `last_seen_at` and occurrence count instead of opening duplicate findings.

## Plans

Plans are requested in JSON format and stored as JSONB. The analysis engine walks every plan node, derives stable paths, calculates aggregate metrics, and emits evidence-backed warnings. Plan comparison matches nodes by identity, relation, and structure before reporting changed timing, cost, estimates, and shape.

Plain EXPLAIN is the normal path. ANALYZE is separately confirmed and executed inside a read-only transaction with local timeouts and a mandatory rollback.

## Capability degradation

Feature availability is computed from:

- PostgreSQL server version
- Installed extensions
- Available statistics/progress views
- Membership in predefined statistics roles
- Server settings such as query tracking
- Recovery/read-only state

Every unsupported feature produces an explicit capability state in the UI. The application does not replace unavailable database evidence with guessed data.

## Performance model

- Inventory SQL uses deterministic ordering, cursor/limit bounds, and narrow projections.
- Snapshot history has source/time and resource/time indexes.
- Live polling can be paused and does not overlap requests.
- Heavy SQL editor and plan visualization code is client-only and split from initial routes.
- Charts consume pre-aggregated time buckets rather than unbounded raw history.
- API and bundle benchmarks are recorded under `artifacts/`, which is intentionally untracked.

