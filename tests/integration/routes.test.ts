import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as advisor } from "../../app/api/advisor/route";
import { GET as advisorContext } from "../../app/api/advisor/context/route";
import { POST as explainConfirmation } from "../../app/api/explain/confirm/route";
import { POST as explain } from "../../app/api/explain/route";
import { GET as findings } from "../../app/api/findings/route";
import { GET as indexes } from "../../app/api/indexes/route";
import { POST as hypotheticalIndex } from "../../app/api/indexes/hypothetical/route";
import { GET as maintenance } from "../../app/api/maintenance/route";
import { GET as queries } from "../../app/api/queries/route";
import { POST as bloat } from "../../app/api/maintenance/bloat/route";
import { POST as comparePlans } from "../../app/api/plans/compare/route";
import { GET as plans } from "../../app/api/plans/route";
import { closeDatabasePools } from "../../lib/db/client";
import { loadAdvisorPageData } from "../../lib/server/dashboard-data";
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
    const sql = "SELECT * FROM sales.orders WHERE id > 0 LIMIT 5";
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

  it("groups literal variants under one redacted plan digest", async () => {
    const runs: string[] = [];
    for (const sql of [
      "SELECT * FROM sales.orders WHERE customer_id = 42 AND status = 'paid'",
      "SELECT * FROM sales.orders WHERE customer_id = 7 AND status = 'pending'",
    ]) {
      const response = await explain(
        request("http://local.test/api/explain", { sql, persist: true }),
      );
      const body = (await response.json()) as { runId?: string };
      expect(response.status).toBe(200);
      runs.push(body.runId!);
    }
    const persisted = await database.pool.query<{
      query_digest: string;
      normalized_query: string;
    }>(
      `SELECT query_digest, normalized_query
       FROM index_analyzer.explain_runs WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [runs],
    );
    expect(new Set(persisted.rows.map((row) => row.query_digest)).size).toBe(1);
    expect(
      new Set(persisted.rows.map((row) => row.normalized_query)).size,
    ).toBe(1);
    expect(JSON.stringify(persisted.rows)).not.toMatch(/paid|pending|42/);
  });

  it("loads saved Advisor history for a registered source", async () => {
    await expect(loadAdvisorPageData("local")).resolves.toMatchObject({
      analyses: expect.any(Array),
      source: { mode: "live", label: "Saved analyses" },
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

  it("assembles bounded live query, history, catalog, index, setting, and safe plan evidence", async () => {
    const workload = await database.pool.query<{
      queryid: string;
      query: string;
    }>(`
      SELECT queryid::text, query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query LIKE '%sales.orders%'
      ORDER BY calls DESC
      LIMIT 1
    `);
    const selected = workload.rows[0];
    expect(selected).toBeTruthy();

    const response = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&queryId=${selected!.queryid}`,
      ),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ready: true,
      source: {
        key: "local",
        label: "Route fixture",
        database: database.name,
      },
      selection: { queryId: selected!.queryid },
      evidence: {
        queryOrigin: "live",
        historySamples: expect.any(Number),
        settings: expect.any(Number),
      },
      input: {
        source: "local",
        sourceDatabaseId,
        query: selected!.query,
        context: { queryId: selected!.queryid },
      },
    });
    expect(body.evidence.historySamples).toBeGreaterThan(0);
    expect(body.evidence.settings).toBeGreaterThan(10);
    expect(body.input.statistics["query.calls"]).toBeGreaterThan(0);
    expect(body.input.statistics["history.1.calls"]).toBeDefined();
    expect(body.input.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "sales",
          name: "orders",
          columns: expect.arrayContaining([
            expect.objectContaining({
              name: "customer_id",
              statistics: expect.objectContaining({
                distinctEstimate: expect.any(Number),
                histogramBoundaryCount: expect.any(Number),
              }),
            }),
          ]),
        }),
      ]),
    );
    expect(body.input.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schema: "sales", table: "orders" }),
      ]),
    );

    const mismatchedPlanId = crypto.randomUUID();
    await database.pool.query(
      `INSERT INTO index_analyzer.explain_runs
        (id, source_database_id, query_digest, normalized_query, analyze_enabled,
         statement_timeout_ms, plan_json)
       VALUES ($1, $2, 'different', 'SELECT 1', false, 5000,
         '[{"Plan":{"Node Type":"Result"}}]'::jsonb)`,
      [mismatchedPlanId, sourceDatabaseId],
    );
    const mismatch = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&queryId=${selected!.queryid}&planId=${mismatchedPlanId}`,
      ),
    );
    const mismatchBody = (await mismatch.json()) as Record<string, any>;
    expect(mismatch.status).toBe(200);
    expect(mismatchBody.input.plan).toBeUndefined();
    expect(mismatchBody.input.explainRunId).toBeUndefined();
    expect(mismatchBody.omissions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/plan was omitted.*does not match/i),
      ]),
    );

    const planOnly = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&planId=${mismatchedPlanId}`,
      ),
    );
    const planOnlyBody = (await planOnly.json()) as Record<string, any>;
    expect(planOnly.status).toBe(200);
    expect(planOnlyBody).toMatchObject({
      ready: true,
      selection: { planId: mismatchedPlanId },
      evidence: { queryOrigin: "plan", planMatch: "explicit" },
      input: {
        query: "SELECT 1",
        explainRunId: mismatchedPlanId,
        context: { planId: mismatchedPlanId },
        plan: [{ Plan: { "Node Type": "Result" } }],
      },
    });
  });

  it("assembles finding-only evidence without inventing query text", async () => {
    const finding = await database.pool.query<{ id: string }>(
      `INSERT INTO index_analyzer.findings
        (source_database_id, fingerprint, category, severity, title, summary, evidence, destination)
       VALUES ($1, $2, 'index', 'warning', 'Index write overhead',
         'Catalog evidence identifies a high-cost index.',
         '{"schema":"sales","table":"orders","sizeBytes":1048576}'::jsonb,
         '{"href":"/indexes"}'::jsonb)
       RETURNING id::text`,
      [sourceDatabaseId, `advisor-context-${crypto.randomUUID()}`],
    );
    const response = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&findingId=${finding.rows[0]!.id}`,
      ),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.input.query).toBeUndefined();
    expect(body.input.context.finding).toMatchObject({
      id: finding.rows[0]!.id,
      category: "index",
      title: "Index write overhead",
    });
    expect(body.input.statistics).toMatchObject({
      "finding.evidence.schema": "sales",
      "finding.evidence.table": "orders",
      "finding.evidence.sizeBytes": 1_048_576,
    });
    expect(body.input.tables[0]).toMatchObject({
      schema: "sales",
      name: "orders",
    });
    expect(body.omissions).toEqual(
      expect.arrayContaining([expect.stringMatching(/no normalized query/i)]),
    );
  });

  it("assembles explicit relation and index catalog context", async () => {
    const catalogIndex = await database.pool.query<{ name: string }>(
      `SELECT i.relname AS name FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'sales' AND t.relname = 'orders'
       ORDER BY x.indisprimary DESC, i.relname LIMIT 1`,
    );
    const indexName = catalogIndex.rows[0]!.name;
    const response = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&relationSchema=sales&relationTable=orders&index=${encodeURIComponent(indexName)}`,
      ),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ready: true,
      selection: { relation: "sales.orders", index: indexName },
      evidence: { queryOrigin: null, tables: ["sales.orders"] },
      input: {
        context: { relation: "sales.orders", index: indexName },
      },
    });
    expect(body.input.query).toBeUndefined();
    expect(body.input.tables[0].columns.length).toBeGreaterThan(0);
    expect(body.input.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ schema: "sales", table: "orders" }),
      ]),
    );
  });

  it("rejects foreign plan ownership for context and persistence", async () => {
    const foreign = await database.pool.query<{ id: string }>(
      `WITH source AS (
         INSERT INTO index_analyzer.sources (source_key, display_name, binding_name)
         VALUES ('foreign', 'Foreign fixture', 'FOREIGN_DATABASE_URL')
         RETURNING id
       )
       INSERT INTO index_analyzer.source_databases
         (source_id, database_oid, database_name, server_version)
       SELECT id, 999999::oid, 'foreign_fixture', 160000 FROM source
       RETURNING id::text`,
    );
    const planId = crypto.randomUUID();
    await database.pool.query(
      `INSERT INTO index_analyzer.explain_runs
        (id, source_database_id, query_digest, normalized_query,
         analyze_enabled, statement_timeout_ms, plan_json)
       VALUES ($1, $2, 'foreign-digest', 'SELECT 1', false, 5000,
         '[{"Plan":{"Node Type":"Result"}}]'::jsonb)`,
      [planId, Number(foreign.rows[0]?.id)],
    );
    const context = await advisorContext(
      request(
        `http://local.test/api/advisor/context?source=local&planId=${planId}`,
      ),
    );
    expect(context.status).toBe(404);

    const submission = await advisor(
      request("http://local.test/api/advisor", {
        source: "local",
        sourceDatabaseId,
        explainRunId: planId,
        query: "SELECT 1",
        submit: true,
        persist: true,
      }),
    );
    expect(submission.status).toBe(400);
    await expect(submission.json()).resolves.toMatchObject({
      error: { code: "advisor_plan_mismatch" },
    });
  });

  it("persists deterministic structured AI analysis and lists findings", async () => {
    const analysis = await advisor(
      request("http://local.test/api/advisor", {
        source: "local",
        query: "SELECT * FROM sales.orders WHERE customer_id = 42",
        submit: true,
        persist: true,
        sourceDatabaseId,
        plan: [
          {
            Plan: {
              "Node Type": "Seq Scan",
              "Relation Name": "orders",
              "Plan Rows": 100000,
              "Total Cost": 1000,
            },
          },
        ],
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
    const history = await loadAdvisorPageData("local");
    expect(history.analyses[0]?.result).toMatchObject({
      summary: expect.any(String),
      caveats: expect.arrayContaining([expect.any(String)]),
      evidence: expect.any(Array),
      recommendations: expect.any(Array),
    });

    const mismatchedSource = await advisor(
      request("http://local.test/api/advisor", {
        source: "other-target",
        query: "SELECT 1",
        submit: true,
        persist: true,
        sourceDatabaseId,
      }),
    );
    expect(mismatchedSource.status).toBe(400);
    await expect(mismatchedSource.json()).resolves.toMatchObject({
      error: { code: "advisor_source_mismatch" },
    });

    const findingResponse = await findings(
      request("http://local.test/api/findings?limit=250"),
    );
    const findingBody = (await findingResponse.json()) as {
      findings: unknown[];
    };
    expect(findingResponse.status).toBe(200);
    expect(findingBody.findings.length).toBeGreaterThan(0);
  });

  it("returns presentation-ready bounded inventory pages and server-side filters", async () => {
    const queryResponse = await queries(
      request(
        "http://local.test/api/queries?source=local&limit=2&search=sales.orders",
      ),
    );
    const queryBody = (await queryResponse.json()) as Record<string, any>;
    expect(queryResponse.status).toBe(200);
    expect(queryBody.pagination).toMatchObject({ limit: 2, offset: 0 });
    expect(queryBody.queryViews.length).toBeLessThanOrEqual(2);
    expect(queryBody.queryViews[0]).toMatchObject({
      id: expect.any(String),
      query: expect.stringContaining("sales.orders"),
      points: [],
    });

    const indexResponse = await indexes(
      request(
        "http://local.test/api/indexes?source=local&schema=sales&limit=2",
      ),
    );
    const indexBody = (await indexResponse.json()) as Record<string, any>;
    expect(indexResponse.status).toBe(200);
    expect(indexBody.indexViews.length).toBeLessThanOrEqual(2);
    expect(indexBody.indexViews[0]).toMatchObject({
      schema: "sales",
      keyColumns: expect.any(Array),
    });

    const maintenanceResponse = await maintenance(
      request(
        "http://local.test/api/maintenance?source=local&schema=sales&search=orders&limit=2",
      ),
    );
    const maintenanceBody = (await maintenanceResponse.json()) as Record<
      string,
      any
    >;
    expect(maintenanceResponse.status).toBe(200);
    expect(maintenanceBody.tableViews).toHaveLength(1);
    expect(maintenanceBody.tableViews[0]).toMatchObject({
      schema: "sales",
      table: "orders",
      risk: expect.stringMatching(/^(low|medium|high)$/),
    });
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

  it("capability-gates bounded HypoPG experiments", async () => {
    const response = await hypotheticalIndex(
      request("http://local.test/api/indexes/hypothetical", {
        source: "local",
        sql: "SELECT * FROM sales.orders WHERE customer_id = 42",
        indexSql:
          "CREATE INDEX orders_customer_candidate ON sales.orders (customer_id)",
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "hypopg_unavailable" },
    });
  });
});
