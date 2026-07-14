import type { Queryable } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";

export async function resolveSourceDatabaseId(
  db: Queryable,
  requested?: number,
): Promise<number> {
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || requested <= 0)
  ) {
    throw new ApiError(
      400,
      "invalid_source_database",
      "sourceDatabaseId must be a positive integer.",
    );
  }
  const result = await db.query<{ id: string }>(
    `SELECT id::text FROM index_analyzer.source_databases
     WHERE ($1::bigint IS NULL OR id = $1)
     ORDER BY last_seen_at DESC LIMIT 1`,
    [requested ?? null],
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(
      404,
      "source_database_not_found",
      "No collected source database matches the request. Run the collector first.",
    );
  }
  return id;
}
