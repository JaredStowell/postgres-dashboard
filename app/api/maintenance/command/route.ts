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
    operation: z.enum(["vacuum", "analyze", "vacuum_analyze"]),
  })
  .strict();

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, requestSchema, {
    maxBytes: 8 * 1_024,
  });
  const operation =
    input.operation === "vacuum_analyze"
      ? "VACUUM (ANALYZE)"
      : input.operation.toUpperCase();
  return jsonResponse({
    sql: `${operation} ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)};`,
    executable: false,
    warning:
      "Copy-only maintenance command. Review locks, I/O headroom, table size, and the production change process before execution.",
  });
});
