import type { Queryable } from "./client";
import { boundedPage, type PageInput, toNumber } from "./sql";

export interface ActivitySession {
  processId: number;
  userName: string | null;
  applicationName: string;
  clientAddress: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  transactionStartedAt: Date | null;
  queryStartedAt: Date | null;
  stateChangedAt: Date | null;
  backendType: string;
  blockingProcessIds: number[];
  queryPreview: string;
  transactionAgeSeconds: number;
  queryAgeSeconds: number;
}

export async function listActivity(
  db: Queryable,
  input: PageInput & { includeIdle?: boolean } = {},
): Promise<ActivitySession[]> {
  const page = boundedPage(input);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT pid, usename, application_name, client_addr::text, state, wait_event_type, wait_event,
      xact_start, query_start, state_change, backend_type, pg_blocking_pids(pid) AS blocking_process_ids,
      left(COALESCE(query, ''), 2000) AS query_preview,
      COALESCE(EXTRACT(epoch FROM clock_timestamp() - xact_start), 0) AS transaction_age_seconds,
      COALESCE(EXTRACT(epoch FROM clock_timestamp() - query_start), 0) AS query_age_seconds
    FROM pg_stat_activity
    WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND pid <> pg_backend_pid()
      AND ($1::boolean OR state IS DISTINCT FROM 'idle')
    ORDER BY xact_start NULLS LAST, query_start NULLS LAST
    LIMIT $2 OFFSET $3
  `,
    [input.includeIdle ?? true, page.limit, page.offset],
  );
  return result.rows.map((row) => {
    const date = (key: string) =>
      row[key] ? new Date(String(row[key])) : null;
    return {
      processId: toNumber(row["pid"]),
      userName: row["usename"] === null ? null : String(row["usename"]),
      applicationName: String(row["application_name"] ?? ""),
      clientAddress:
        row["client_addr"] === null ? null : String(row["client_addr"]),
      state: row["state"] === null ? null : String(row["state"]),
      waitEventType:
        row["wait_event_type"] === null ? null : String(row["wait_event_type"]),
      waitEvent: row["wait_event"] === null ? null : String(row["wait_event"]),
      transactionStartedAt: date("xact_start"),
      queryStartedAt: date("query_start"),
      stateChangedAt: date("state_change"),
      backendType: String(row["backend_type"]),
      blockingProcessIds: Array.isArray(row["blocking_process_ids"])
        ? row["blocking_process_ids"].map(toNumber)
        : [],
      queryPreview: String(row["query_preview"]),
      transactionAgeSeconds: toNumber(row["transaction_age_seconds"]),
      queryAgeSeconds: toNumber(row["query_age_seconds"]),
    };
  });
}
