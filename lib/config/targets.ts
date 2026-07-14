import type { RuntimeEnv } from "./env";
import { optionalString } from "./env";

export interface HyperdriveLike {
  connectionString: string;
}

export interface TargetDefinition {
  key: string;
  label: string;
  binding: string;
  connectionString: string;
}

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const BINDING_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function resolveConnectionString(env: RuntimeEnv, binding: string): string {
  const value = env[binding];
  if (typeof value === "string" && value.length > 0) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "connectionString" in value &&
    typeof (value as HyperdriveLike).connectionString === "string"
  ) {
    return (value as HyperdriveLike).connectionString;
  }
  throw new Error(
    `Target binding ${binding} is unavailable or has no connectionString`,
  );
}

export function parseTargetRegistry(
  env: RuntimeEnv,
): ReadonlyMap<string, TargetDefinition> {
  const specification =
    optionalString(env, "INDEX_ANALYZER_TARGETS") ??
    "local:Local PostgreSQL:DATABASE_URL";
  const registry = new Map<string, TargetDefinition>();

  for (const rawEntry of specification.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const [key, label, binding, ...extra] = entry.split(":");
    if (!key || !label || !binding || extra.length > 0) {
      throw new Error(`Invalid target entry: ${entry}`);
    }
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid target key: ${key}`);
    if (!BINDING_PATTERN.test(binding))
      throw new Error(`Invalid target binding: ${binding}`);
    if (registry.has(key)) throw new Error(`Duplicate target key: ${key}`);
    registry.set(key, {
      key,
      label: label.trim(),
      binding,
      connectionString: resolveConnectionString(env, binding),
    });
  }

  if (registry.size === 0)
    throw new Error("At least one database target is required");
  return registry;
}

export function resolveTarget(
  registry: ReadonlyMap<string, TargetDefinition>,
  key: string,
): TargetDefinition {
  const target = registry.get(key);
  if (!target) throw new Error(`Unknown database target: ${key}`);
  return target;
}
