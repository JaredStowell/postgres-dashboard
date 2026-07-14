import { optionalString, type RuntimeEnv } from "@/lib/config/env";
import {
  parseTargetRegistry,
  resolveTarget,
  type TargetDefinition,
} from "@/lib/config/targets";
import { getDatabasePool, type DatabasePool } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { getRuntimeEnv } from "@/lib/runtime/env";

export interface TargetContext {
  env: RuntimeEnv;
  target: TargetDefinition;
  db: DatabasePool;
}

export function selectTarget(
  env: RuntimeEnv,
  requestedSource?: string | null,
): TargetDefinition {
  const registry = parseTargetRegistry(env);
  const source = requestedSource?.trim() || registry.keys().next().value;
  if (!source) throw new ApiError(503, "no_targets", "No database targets are configured.");

  try {
    return resolveTarget(registry, source);
  } catch {
    throw new ApiError(404, "unknown_target", `Unknown database target: ${source}`);
  }
}

export async function getTargetContext(requestedSource?: string | null): Promise<TargetContext> {
  const env = await getRuntimeEnv();
  const target = selectTarget(env, requestedSource);
  return { env, target, db: getDatabasePool(target.connectionString) };
}

export function resolveControlConnectionString(env: RuntimeEnv): string {
  const binding = env.CONTROL_DB;
  if (
    typeof binding === "object" &&
    binding !== null &&
    "connectionString" in binding &&
    typeof (binding as { connectionString?: unknown }).connectionString === "string"
  ) {
    return (binding as { connectionString: string }).connectionString;
  }

  if (typeof binding === "string" && binding.length > 0) return binding;

  const direct = optionalString(env, "CONTROL_DATABASE_URL") ?? optionalString(env, "DATABASE_URL");
  if (direct) return direct;
  throw new ApiError(503, "control_database_unavailable", "The control database is not configured.");
}

export async function getControlDatabase(): Promise<DatabasePool> {
  const env = await getRuntimeEnv();
  return getDatabasePool(resolveControlConnectionString(env));
}

