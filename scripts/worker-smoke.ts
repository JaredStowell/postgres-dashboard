import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const port = 8788;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForWorker(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Workerd is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Timed out waiting for the local Workers runtime");
}

async function request(path: string) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `${path} returned ${response.status}: ${body.slice(0, 200)}`,
    );
  return {
    path,
    status: response.status,
    bytes: new TextEncoder().encode(body).byteLength,
    durationMs: Number((performance.now() - started).toFixed(2)),
    body,
  };
}

async function main() {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "worker/web.mjs",
      "--assets",
      "dist/client",
      "--config",
      "wrangler.jsonc",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--local",
    ],
    { env: process.env, stdio: "ignore" },
  );
  try {
    await waitForWorker();
    const firstHealth = await request("/api/health");
    const home = await request("/");
    if (!home.body.includes("Index Analyzer"))
      throw new Error("Worker homepage did not contain the application shell");
    const assetPath = home.body.match(
      /(?:src|href)="(\/_next\/[^"?]+)["?]/,
    )?.[1];
    if (!assetPath)
      throw new Error("Worker homepage did not reference a client asset");
    const asset = await request(assetPath);
    const queries = await request("/api/queries?limit=250");
    const parallel = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(index % 2 === 0 ? "/api/health" : "/api/indexes?limit=25"),
      ),
    );
    const cancelResponse = await fetch(`${baseUrl}/api/queries?limit=250`);
    if (!cancelResponse.ok || !cancelResponse.body)
      throw new Error("Cancelable Worker response was unavailable");
    const cancelReader = cancelResponse.body.getReader();
    await cancelReader.read();
    await cancelReader.cancel("worker smoke cancellation probe");
    const afterCancellation = await request("/api/health");
    const secondHealth = await request("/api/health");
    const checks = [
      firstHealth,
      home,
      asset,
      queries,
      ...parallel,
      afterCancellation,
      secondHealth,
    ].map(({ body: _body, ...check }) => check);
    const report = {
      generatedAt: new Date().toISOString(),
      runtime: "workerd via wrangler dev",
      concurrency: { parallelRequests: parallel.length, canceledStreams: 1 },
      checks,
    };
    await mkdir(resolve("artifacts"), { recursive: true });
    await writeFile(
      resolve("artifacts/worker-smoke.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveExit) =>
        child.once("exit", () => resolveExit()),
      ),
      new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

void main();
