import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as advisor } from "../../app/api/advisor/route";
import { POST as explainConfirmation } from "../../app/api/explain/confirm/route";
import { POST as explain } from "../../app/api/explain/route";
import { GET as findings } from "../../app/api/findings/route";
import { POST as bloat } from "../../app/api/maintenance/bloat/route";
import { POST as comparePlans } from "../../app/api/plans/compare/route";
import { GET as plans } from "../../app/api/plans/route";
import { closeDatabasePools } from "../../lib/db/client";
import { collectTarget } from "../../scripts/collect";
import { createTestDatabase, type TestDatabase } from "./helpers";

function request(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("database-backed application routes", () => {
  let database: TestDatabase;
  let sourceDatabaseId: number;
  const original = { ...process.env };

  beforeAll(async () => {
    database = await createTestDatabase({ seed: true });
    process.env.DATABASE_URL = database.url;
    process.env.CONTROL_DATABASE_URL = database.url;
    process.env.INDEX_ANALYZER_TARGETS = "local:Route fixture:DATABASE_URL";
    process.env.EXPLAIN_CONFIRMATION_SECRET = "integration-confirmation-secret";
    process.env.AI_MOCK_MODE = "true";
    await collectTarget(database.pool, database.pool, {
      key: "local",
      label: "Route fixture",
      binding: "DATABASE_URL",
    });
    const registered = await database.pool.query<{ id: string }>(
      "SELECT id::text FROM index_analyzer.source_databases LIMIT 1",
    );
    sourceDatabaseId = Number(registered.rows[0]?.id);
  }, 30_000);

  afterAll(async () => {
    await closeDatabasePools();
    await database.destroy();
    process.env = { ...original };
  });

  it("persists plain and explicitly confirmed ANALYZE plans", async () => {
    const sql = "SELECT count(*) FROM sales.orders WHERE status = 'paid'";
    const plain = await explain(
      request("http://local.test/api/explain", { sql, persist: true }),
    );
    const plainBody = (await plain.json()) as {
      runId?: string;
      persistence?: string;
      plan?: unknown;
    };
    expect(plain.status).toBe(200);
    expect(plainBody.persistence).toBe("saved");
    expect(plainBody.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(plainBody.plan).toBeTruthy();

    const confirmation = await explainConfirmation(
      request("http://local.test/api/explain/confirm", {
        sql,
        acknowledgement: "RUN EXPLAIN ANALYZE",
      }),
    );
    const confirmationBody = (await confirmation.json()) as { token: string };
    const analyzed = await explain(
      request("http://local.test/api/explain", {
        sql,
        analyze: true,
        confirmationToken: confirmationBody.token,
        persist: true,
      }),
    );
    expect(analyzed.status).toBe(200);
    await expect(analyzed.json()).resolves.toMatchObject({
      analyze: true,
      persistence: "saved",
    });
  });

  it("lists and persists a plan diff", async () => {
    const response = await plans(
      request("http://local.test/api/plans?limit=10"),
    );
    const body = (await response.json()) as { plans: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.plans.length).toBeGreaterThanOrEqual(2);

    const comparison = await comparePlans(
      request("http://local.test/api/plans/compare", {
        baselineRunId: body.plans[1]!.id,
        candidateRunId: body.plans[0]!.id,
      }),
    );
    expect(comparison.status).toBe(200);
    await expect(comparison.json()).resolves.toMatchObject({
      comparisonId: expect.any(Number),
      diff: { nodes: expect.any(Array), summary: expect.any(Array) },
    });
  });

  it("persists deterministic structured AI analysis and lists findings", async () => {
    const analysis = await advisor(
      request("http://local.test/api/advisor", {
        query: "SELECT * FROM sales.orders WHERE customer_id = 42",
        submit: true,
        persist: true,
        sourceDatabaseId,
      }),
    );
    expect(analysis.status).toBe(200);
    await expect(analysis.json()).resolves.toMatchObject({
      analysisId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      metadata: { model: "deterministic-mock", mock: true },
      analysis: {
        summary: expect.any(String),
        recommendations: expect.any(Array),
      },
    });
    const saved = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM index_analyzer.ai_analysis_results",
    );
    expect(Number(saved.rows[0]?.count)).toBe(1);

    const findingResponse = await findings(
      request("http://local.test/api/findings?limit=250"),
    );
    const findingBody = (await findingResponse.json()) as {
      findings: unknown[];
    };
    expect(findingResponse.status).toBe(200);
    expect(findingBody.findings.length).toBeGreaterThan(0);
  });

  it("runs an acknowledged, bounded pgstattuple check", async () => {
    const relation = await database.pool.query<{ oid: number }>(
      "SELECT 'sales.orders'::regclass::oid::int AS oid",
    );
    const response = await bloat(
      request("http://local.test/api/maintenance/bloat", {
        relationOid: relation.rows[0]!.oid,
        statementTimeoutMs: 5_000,
        acknowledgement: "RUN EXPENSIVE BLOAT CHECK",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        tableLength: expect.any(Number),
        deadTuplePercent: expect.any(Number),
      },
    });
  });
});
