import {
  listFindings,
  updateFindingStatus,
  type FindingStatus,
} from "@/lib/db/findings";
import {
  ApiError,
  boundedInteger,
  jsonResponse,
  parseJson,
  route,
} from "@/lib/http/api";
import { getControlDatabase } from "@/lib/server/context";
import { z } from "zod";

const statuses = new Set<FindingStatus>([
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
]);
const updateSchema = z
  .object({
    findingId: z.number().int().positive(),
    status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
    note: z.string().max(4_000).optional(),
  })
  .strict();

export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const statusInput = url.searchParams.get("status");
  if (statusInput && !statuses.has(statusInput as FindingStatus)) {
    throw new ApiError(400, "invalid_status", "Unsupported finding status.");
  }
  const limit = boundedInteger(url.searchParams.get("limit"), 100, {
    min: 1,
    max: 250,
    name: "limit",
  });
  const offset = boundedInteger(url.searchParams.get("offset"), 0, {
    min: 0,
    max: 100_000,
    name: "offset",
  });
  const sourceInput = url.searchParams.get("sourceDatabaseId");
  const sourceDatabaseId = sourceInput
    ? boundedInteger(sourceInput, 0, {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
        name: "sourceDatabaseId",
      })
    : undefined;
  const findings = await listFindings(await getControlDatabase(), {
    limit,
    offset,
    sourceDatabaseId,
    status: statusInput as FindingStatus | undefined,
  });
  return jsonResponse({
    pagination: { limit, offset, returned: findings.length },
    findings,
  });
});

export const PATCH = route(async (request: Request) => {
  const input = await parseJson(request, updateSchema);
  await updateFindingStatus(await getControlDatabase(), {
    ...input,
    changedBy: "dashboard",
  });
  return jsonResponse({
    ok: true,
    findingId: input.findingId,
    status: input.status,
  });
});
