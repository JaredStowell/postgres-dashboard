import { quoteIdentifier } from "@/lib/analysis/sql-safety";
import { jsonResponse, parseJson, route } from "@/lib/http/api";
import { z } from "zod";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .refine((value) => !value.includes("\0"));
const requestSchema = z
  .object({
    schema: identifier,
    table: identifier,
    columns: z.array(identifier).min(1).max(16),
    include: z.array(identifier).max(16).default([]),
    unique: z.boolean().default(false),
    name: identifier.optional(),
  })
  .strict();

function defaultName(schema: string, table: string, columns: string[]): string {
  const raw = `${schema}_${table}_${columns.join("_")}_idx`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  return raw.slice(0, 63) || "index_analyzer_candidate_idx";
}

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema, {
    maxBytes: 32 * 1_024,
  });
  const indexName =
    input.name ?? defaultName(input.schema, input.table, input.columns);
  const include = input.include.length
    ? ` INCLUDE (${input.include.map(quoteIdentifier).join(", ")})`
    : "";
  const sql = `CREATE ${input.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY ${quoteIdentifier(indexName)} ON ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)} (${input.columns.map(quoteIdentifier).join(", ")})${include};`;
  return jsonResponse({
    sql,
    executable: false,
    warning:
      "Review-only candidate. Validate selectivity, write cost, disk headroom, and plans before running it manually.",
  });
});
