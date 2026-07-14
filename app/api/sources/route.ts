import { parseTargetRegistry } from "@/lib/config/targets";
import { jsonResponse, route } from "@/lib/http/api";
import { getRuntimeEnv } from "@/lib/runtime/env";
import { getControlDatabase } from "@/lib/server/context";

interface SourceMetadataRow {
  source_key: string;
  database_name: string;
  server_version: number;
  collection_status: string | null;
  collection_started_at: string | null;
  collected_at: string | null;
  schemas: string[] | null;
}

export const GET = route(async () => {
  const env = await getRuntimeEnv();
  const targets = [...parseTargetRegistry(env).values()];
  let metadata: SourceMetadataRow[] = [];
  try {
    const control = await getControlDatabase();
    const result = await control.query<SourceMetadataRow>(`
      SELECT s.source_key, d.database_name, d.server_version,
        latest.status AS collection_status,
        latest.started_at::text AS collection_started_at,
        successful.finished_at::text AS collected_at,
        COALESCE(successful.schemas, ARRAY[]::text[]) AS schemas
      FROM index_analyzer.sources s
      JOIN index_analyzer.source_databases d ON d.source_id = s.id
      LEFT JOIN LATERAL (
        SELECT cr.status, cr.started_at
        FROM index_analyzer.collection_runs cr
        WHERE cr.source_database_id = d.id
        ORDER BY cr.started_at DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT cr.finished_at,
          ARRAY(
            SELECT DISTINCT ts.schema_name::text
            FROM index_analyzer.table_snapshots ts
            WHERE ts.collection_run_id = cr.id
            ORDER BY ts.schema_name::text
            LIMIT 250
          ) AS schemas
        FROM index_analyzer.collection_runs cr
        WHERE cr.source_database_id = d.id AND cr.status = 'succeeded'
        ORDER BY cr.started_at DESC LIMIT 1
      ) successful ON true
      WHERE s.enabled
      ORDER BY s.display_name, d.database_name
      LIMIT 250
    `);
    metadata = result.rows;
  } catch {
    // Target registry remains visible before the control database is initialized.
  }
  const bySource = new Map(metadata.map((row) => [row.source_key, row]));
  const sources = targets.map((target) => {
    const collected = bySource.get(target.key);
    return {
      key: target.key,
      label: target.label,
      database: collected?.database_name ?? "Awaiting collection",
      schemas: collected?.schemas ?? [],
      serverVersion: collected?.server_version ?? null,
      available: Boolean(collected),
      collectionStatus: collected?.collection_status ?? "not_collected",
      collectionStartedAt: collected?.collection_started_at ?? null,
      collectedAt: collected?.collected_at ?? null,
    };
  });
  return jsonResponse({
    sources,
    discoveredAt: new Date().toISOString(),
    freshnessSource: "control-plane collection history",
  });
});
