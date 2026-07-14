import type { DatabasePool, Queryable } from "./client";
import { boundedPage, type PageInput, toNumber } from "./sql";

export type FindingStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export async function listFindings(
  db: Queryable,
  input: PageInput & { sourceDatabaseId?: number; status?: FindingStatus } = {},
): Promise<Record<string, unknown>[]> {
  const page = boundedPage(input);
  const result = await db.query<Record<string, unknown>>(
    `
    SELECT f.*, r.rule_key, r.display_name AS rule_name
    FROM index_analyzer.findings f
    LEFT JOIN index_analyzer.alert_rules r ON r.id = f.rule_id
    WHERE ($1::bigint IS NULL OR f.source_database_id = $1)
      AND ($2::text IS NULL OR f.status = $2)
    ORDER BY CASE f.severity
      WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'warning' THEN 3
      WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC,
      f.last_seen_at DESC
    LIMIT $3 OFFSET $4
  `,
    [
      input.sourceDatabaseId ?? null,
      input.status ?? null,
      page.limit,
      page.offset,
    ],
  );
  return result.rows;
}

export async function updateFindingStatus(
  db: DatabasePool,
  input: {
    findingId: number;
    status: FindingStatus;
    changedBy?: string;
    note?: string;
  },
): Promise<void> {
  if (!Number.isSafeInteger(input.findingId) || input.findingId <= 0) {
    throw new Error("Invalid finding ID");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ status: FindingStatus }>(
      "SELECT status FROM index_analyzer.findings WHERE id = $1 FOR UPDATE",
      [input.findingId],
    );
    const previous = current.rows[0]?.status;
    if (!previous) throw new Error("Finding not found");
    if (previous !== input.status) {
      await client.query(
        `
        UPDATE index_analyzer.findings SET status = $2,
          resolved_at = CASE WHEN $2 = 'resolved' THEN clock_timestamp() ELSE NULL END
        WHERE id = $1
      `,
        [input.findingId, input.status],
      );
      await client.query(
        `
        INSERT INTO index_analyzer.finding_status_history
          (finding_id, from_status, to_status, changed_by, note)
        VALUES ($1,$2,$3,$4,$5)
      `,
        [
          input.findingId,
          previous,
          input.status,
          input.changedBy ?? null,
          input.note?.slice(0, 4_000) ?? null,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addFindingAnnotation(
  db: Queryable,
  findingId: number,
  body: string,
  createdBy?: string,
): Promise<number> {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4_000)
    throw new Error("Annotation must be 1 to 4000 characters");
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO index_analyzer.finding_annotations (finding_id, created_by, body)
    VALUES ($1,$2,$3) RETURNING id
  `,
    [findingId, createdBy ?? null, trimmed],
  );
  return toNumber(result.rows[0]?.id);
}
