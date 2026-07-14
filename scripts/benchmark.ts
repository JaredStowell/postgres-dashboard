import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createDatabasePool } from "../lib/db/client";
import { listIndexes } from "../lib/db/indexes";
import type { IndexInfo } from "../lib/db/indexes";
import { listTableMaintenance } from "../lib/db/maintenance";
import { listQueryStats } from "../lib/db/workload";
import type { QueryStat } from "../lib/db/workload";
import { presentIndexes, presentQuery } from "../lib/presentation/inventory";

interface TimingResult {
  samples: number;
  rows: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgres://index_analyzer:index_analyzer@127.0.0.1:55433/index_analyzer";
const routeBudgetMs = 750;
const databaseBudgetMs = 400;
const initialGzipBudgetBytes = 180 * 1024;
const heapBudgetBytes = 160 * 1024 * 1024;
const highCardinalityBudgetMs = 150;

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return (
    ordered[
      Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
    ] ?? 0
  );
}

async function timeInventory(
  samples: number,
  operation: (offset: number) => Promise<unknown[]>,
): Promise<TimingResult> {
  const durations: number[] = [];
  let rows = 0;
  await operation(0);
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    const result = await operation((index % 20) * 250);
    durations.push(performance.now() - started);
    rows += result.length;
  }
  return {
    samples,
    rows,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...durations).toFixed(2)),
  };
}

function highCardinalityReport() {
  const rows: QueryStat[] = Array.from({ length: 10_000 }, (_, index) => ({
    queryId: String(index + 1),
    userOid: 10,
    userName: `role_${index % 50}`,
    databaseOid: 16_384,
    databaseName: "high_cardinality_fixture",
    query: `SELECT * FROM tenant_${index % 500}.events WHERE id = $1`,
    toplevel: true,
    calls: 10_000 - index,
    totalPlanTime: index / 10,
    meanPlanTime: 0.1,
    totalExecTime: 50_000 - index,
    meanExecTime: 5 + (index % 100) / 10,
    rows: index * 3,
    sharedBlocksHit: 10_000,
    sharedBlocksRead: index % 1_000,
    sharedBlocksDirtied: 0,
    sharedBlocksWritten: 0,
    tempBlocksRead: index % 20,
    tempBlocksWritten: index % 10,
    walRecords: index % 100,
    walBytes: index * 64,
    statsSince: null,
    minmaxStatsSince: null,
  }));
  const indexes: IndexInfo[] = Array.from({ length: 10_000 }, (_, index) => ({
    indexOid: index + 20_000,
    tableOid: Math.floor(index / 8) + 40_000,
    schema: `tenant_${index % 500}`,
    table: `events_${Math.floor(index / 8)}`,
    name: `events_${index}_idx`,
    definition: `CREATE INDEX events_${index}_idx ON tenant_${index % 500}.events_${Math.floor(index / 8)} (created_at)`,
    accessMethod: "btree",
    unique: false,
    primary: false,
    valid: true,
    ready: true,
    scans: index % 1_000,
    tuplesRead: index * 2,
    tuplesFetched: index,
    sizeBytes: 1_048_576 + index * 128,
    keyColumns: ["created_at"],
    includedColumns: [],
    predicate: null,
    constraintBacked: false,
    tableInserts: index * 3,
    tableUpdates: index * 2,
    tableDeletes: index,
    tableHotUpdates: index,
    tableBytes: 100_000_000,
    tableIndexCount: 8,
    totalTableIndexBytes: 32_000_000,
  }));
  const queryDurations: number[] = [];
  const indexDurations: number[] = [];
  for (let sample = 0; sample < 20; sample += 1) {
    let started = performance.now();
    rows
      .map(presentQuery)
      .sort((left, right) => right.totalTime - left.totalTime)
      .slice(0, 250);
    queryDurations.push(performance.now() - started);
    started = performance.now();
    presentIndexes(indexes, [])
      .sort((left, right) => (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0))
      .slice(0, 250);
    indexDurations.push(performance.now() - started);
  }
  const timings = (durations: number[]) => ({
    samples: durations.length,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...durations).toFixed(2)),
  });
  return {
    queryFixtureRows: rows.length,
    indexFixtureRows: indexes.length,
    queries: timings(queryDurations),
    indexes: timings(indexDurations),
  };
}

async function bundleReport() {
  const clientDirectory = resolve("dist/client");
  const manifestPath = resolve(clientDirectory, ".vite/manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      { file?: string; imports?: string[]; dynamicImports?: string[] }
    >;
    const entryManifest = JSON.parse(
      await readFile(
        resolve(clientDirectory, "vinext-client-entry-manifest.json"),
        "utf8",
      ),
    ) as { appBrowserEntry: string };
    const byFile = new Map(
      Object.values(manifest).map((value) => [value.file, value]),
    );
    const initial = new Set<string>([entryManifest.appBrowserEntry]);
    const appShell = Object.entries(manifest).find(([key]) =>
      key.endsWith("components/shell/app-shell.tsx"),
    )?.[1];
    if (appShell?.file) initial.add(appShell.file);
    const visit = (file: string) => {
      const item = byFile.get(file);
      for (const dependencyKey of item?.imports ?? []) {
        const dependency = manifest[dependencyKey]?.file;
        if (dependency && !initial.has(dependency)) {
          initial.add(dependency);
          visit(dependency);
        }
      }
    };
    for (const file of initial) visit(file);
    const chunks = await Promise.all(
      Array.from(initial)
        .sort()
        .map(async (file) => {
          const contents = await readFile(resolve(clientDirectory, file));
          return {
            file,
            bytes: contents.byteLength,
            gzipBytes: gzipSync(contents).byteLength,
          };
        }),
    );
    const sqlEditor = Object.entries(manifest).find(([key]) =>
      key.endsWith("components/plans/sql-editor.tsx"),
    )?.[1].file;
    return {
      available: true,
      chunks,
      initialBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
      initialGzipBytes: chunks.reduce(
        (total, chunk) => total + chunk.gzipBytes,
        0,
      ),
      sqlEditorLazy: Boolean(sqlEditor && !initial.has(sqlEditor)),
    };
  } catch {
    return {
      available: false,
      chunks: [],
      initialBytes: 0,
      initialGzipBytes: 0,
      sqlEditorLazy: false,
    };
  }
}

async function routeReport(baseUrl: string | undefined) {
  if (!baseUrl) return { available: false, routes: [] };
  const paths = [
    "/",
    "/queries",
    "/indexes",
    "/maintenance",
    "/live",
    "/api/queries?limit=250",
    "/api/indexes?limit=250",
  ];
  const routes = [];
  for (const path of paths) {
    const durations: number[] = [];
    let bytes = 0;
    for (let sample = 0; sample < 5; sample += 1) {
      const started = performance.now();
      const response = await fetch(new URL(path, baseUrl), {
        headers: {
          accept: path.startsWith("/api/") ? "application/json" : "text/html",
        },
      });
      const body = await response.arrayBuffer();
      if (!response.ok)
        throw new Error(`${path} returned HTTP ${response.status}`);
      durations.push(performance.now() - started);
      bytes = body.byteLength;
    }
    routes.push({
      path,
      bytes,
      p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    });
  }
  return { available: true, routes };
}

async function routeServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const configured = process.env["BENCHMARK_BASE_URL"];
  if (configured) return { baseUrl: configured, stop: async () => undefined };
  const baseUrl = "http://127.0.0.1:4180";
  const child = spawn(
    "pnpm",
    ["exec", "vinext", "start", "-p", "4180", "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        CONTROL_DATABASE_URL:
          process.env["CONTROL_DATABASE_URL"] ?? databaseUrl,
        INDEX_ANALYZER_TARGETS:
          process.env["INDEX_ANALYZER_TARGETS"] ??
          "local:Local PostgreSQL:DATABASE_URL",
        AI_MOCK_MODE: process.env["AI_MOCK_MODE"] ?? "true",
        EXPLAIN_CONFIRMATION_SECRET:
          process.env["EXPLAIN_CONFIRMATION_SECRET"] ??
          "local-development-confirmation-secret",
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Benchmark server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          stop: async () => {
            if (child.exitCode !== null) return;
            child.kill("SIGTERM");
            await Promise.race([
              new Promise<void>((resolveStop) =>
                child.once("exit", () => resolveStop()),
              ),
              new Promise<void>((resolveStop) =>
                setTimeout(resolveStop, 5_000),
              ),
            ]);
            if (child.exitCode === null) child.kill("SIGKILL");
          },
        };
      }
    } catch {
      // Production server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  child.kill("SIGKILL");
  throw new Error("Timed out waiting for the benchmark production server");
}

async function main() {
  const pool = createDatabasePool(databaseUrl, { max: 12 });
  const server = await routeServer();
  const heapBefore = process.memoryUsage().heapUsed;
  try {
    const [queries, indexes, maintenance] = await Promise.all([
      timeInventory(30, (offset) =>
        listQueryStats(pool, { limit: 250, offset }),
      ),
      timeInventory(30, (offset) => listIndexes(pool, { limit: 250, offset })),
      timeInventory(30, (offset) =>
        listTableMaintenance(pool, { limit: 250, offset }),
      ),
    ]);
    const [bundle, routes] = await Promise.all([
      bundleReport(),
      routeReport(server.baseUrl),
    ]);
    const highCardinality = highCardinalityReport();
    const heapDeltaBytes = Math.max(
      0,
      process.memoryUsage().heapUsed - heapBefore,
    );
    const failures: string[] = [];
    for (const [name, result] of Object.entries({
      queries,
      indexes,
      maintenance,
    })) {
      if (result.p95Ms > databaseBudgetMs)
        failures.push(
          `${name} p95 ${result.p95Ms}ms exceeds ${databaseBudgetMs}ms`,
        );
    }
    for (const route of routes.routes) {
      if (route.p95Ms > routeBudgetMs)
        failures.push(
          `${route.path} p95 ${route.p95Ms}ms exceeds ${routeBudgetMs}ms`,
        );
    }
    if (bundle.available && bundle.initialGzipBytes > initialGzipBudgetBytes)
      failures.push(
        `initial gzip ${bundle.initialGzipBytes} exceeds ${initialGzipBudgetBytes} bytes`,
      );
    if (bundle.available && !bundle.sqlEditorLazy)
      failures.push(
        "CodeMirror SQL editor is not isolated from the initial bundle",
      );
    if (heapDeltaBytes > heapBudgetBytes)
      failures.push(
        `heap delta ${heapDeltaBytes} exceeds ${heapBudgetBytes} bytes`,
      );
    if (
      highCardinality.queries.p95Ms > highCardinalityBudgetMs ||
      highCardinality.indexes.p95Ms > highCardinalityBudgetMs
    )
      failures.push(
        `10k-row presentation exceeds ${highCardinalityBudgetMs}ms p95 (queries ${highCardinality.queries.p95Ms}ms, indexes ${highCardinality.indexes.p95Ms}ms)`,
      );
    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        database: new URL(databaseUrl).pathname.slice(1),
      },
      budgets: {
        databaseP95Ms: databaseBudgetMs,
        routeP95Ms: routeBudgetMs,
        initialGzipBytes: initialGzipBudgetBytes,
        heapDeltaBytes: heapBudgetBytes,
        highCardinalityP95Ms: highCardinalityBudgetMs,
      },
      inventories: { queries, indexes, maintenance },
      highCardinality,
      routes,
      bundle,
      heapDeltaBytes,
      failures,
    };
    await mkdir(resolve("artifacts"), { recursive: true });
    await writeFile(
      resolve("artifacts/performance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const markdown = [
      "# Index Analyzer performance report",
      "",
      `Generated ${report.generatedAt}.`,
      "",
      "| Inventory | Samples | Rows returned | p50 | p95 | max |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(report.inventories).map(
        ([name, value]) =>
          `| ${name} | ${value.samples} | ${value.rows} | ${value.p50Ms} ms | ${value.p95Ms} ms | ${value.maxMs} ms |`,
      ),
      "",
      `Initial client bundle: ${bundle.available ? `${bundle.initialGzipBytes} gzip bytes across ${bundle.chunks.length} chunks` : "run pnpm build to measure"}.`,
      `SQL editor lazy split: ${bundle.sqlEditorLazy ? "yes" : "not measured"}.`,
      `Heap delta: ${heapDeltaBytes} bytes.`,
      `10,000-row query presentation fixture: ${highCardinality.queries.p95Ms} ms p95 across ${highCardinality.queries.samples} samples.`,
      `10,000-row index presentation fixture: ${highCardinality.indexes.p95Ms} ms p95 across ${highCardinality.indexes.samples} samples.`,
      "",
      failures.length === 0
        ? "All measured performance budgets passed."
        : `Failures: ${failures.join("; ")}`,
      "",
    ].join("\n");
    await writeFile(resolve("artifacts/performance.md"), markdown);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
    await server.stop();
  }
}

void main();
