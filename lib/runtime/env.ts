import type { RuntimeEnv } from "@/lib/config/env";

function processRuntimeEnv(): RuntimeEnv {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env as RuntimeEnv;
}

/**
 * Resolve native Worker bindings when running under workerd and use process.env
 * for scripts/tests. The dynamic import is externalized by the Cloudflare Vite
 * plugin and intentionally caught outside Workers.
 */
export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  try {
    const module = await import("cloudflare:workers");
    return module.env as RuntimeEnv;
  } catch {
    return processRuntimeEnv();
  }
}

