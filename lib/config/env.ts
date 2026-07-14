export type RuntimeEnv = Record<string, unknown>;

export function optionalString(
  env: RuntimeEnv,
  key: string,
): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requiredString(env: RuntimeEnv, key: string): string {
  const value = optionalString(env, key);
  if (!value) throw new Error(`Missing required environment value: ${key}`);
  return value;
}

export function integerFromEnv(
  env: RuntimeEnv,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = optionalString(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    throw new Error(
      `${key} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
  return value;
}
