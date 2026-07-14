export const env =
  (globalThis as typeof globalThis & { __CLOUDFLARE_ENV__?: Record<string, unknown> })
    .__CLOUDFLARE_ENV__ ?? {};

