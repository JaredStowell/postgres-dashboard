# Security Model

## Trust boundary

Index Analyzer is an operator tool intended to run behind Cloudflare Access or an equivalent identity-aware proxy. The application does not implement public self-service authentication. Production access must be restricted before the Worker route is exposed.

## Database roles

Use dedicated user-defined PostgreSQL roles and rotate their credentials through Hyperdrive. A statistics-only deployment needs catalog visibility plus `pg_read_all_stats` to inspect query text from other users. EXPLAIN needs read access to the referenced objects, so a production installation may use a separate, more privileged read-only binding for the Plan Lab.

Do not use the PlanetScale default administration role for application traffic. Do not grant write roles to monitored schemas.

Suggested role defaults for the EXPLAIN connection:

```sql
ALTER ROLE index_analyzer_explain SET default_transaction_read_only = on;
ALTER ROLE index_analyzer_explain SET statement_timeout = '10s';
ALTER ROLE index_analyzer_explain SET lock_timeout = '1s';
ALTER ROLE index_analyzer_explain SET idle_in_transaction_session_timeout = '15s';
```

The route applies stricter transaction-local limits as a second layer.

## EXPLAIN boundary

- Only one statement is accepted.
- Plain EXPLAIN is the default.
- ANALYZE requires a short-lived server-generated confirmation token.
- ANALYZE accepts read-only statement classes and still warns about volatile functions.
- The operation runs in `BEGIN READ ONLY`, applies local timeouts, and always rolls back.
- There is no generic query-result endpoint and no terminate/cancel endpoint.

PostgreSQL functions can perform external side effects even inside a read-only transaction. The database role must therefore have only trusted function execution privileges.

## AI boundary

- The API key is a Worker secret and never appears in client bundles.
- Query literals and comments are redacted by default.
- Result rows are never included.
- Payloads are size-bounded and previewed before submission.
- OpenAI response storage is disabled.
- Structured output is validated before persistence or rendering.
- Model-generated SQL is never executed automatically.
- Logs include request IDs and failure classes, not payloads or credentials.

## Logging and exports

Connection strings, passwords, API keys, raw credentials, and request authorization headers are forbidden in application logs and control-plane tables. Sanitized reports omit credentials, raw result data, and unredacted literals.

## Hyperdrive caching

Operational target bindings must have query caching disabled. Cached activity, locks, statistics, permissions, and plan inputs can be dangerously stale. Hyperdrive connection pooling remains active when query caching is disabled.

