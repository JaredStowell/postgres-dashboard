import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";

const analysis = {
  summary: "The workload shift invalidated the planner assumption.",
  severity: "high" as const,
  confidence: 0.94,
  evidence: [],
  caveats: ["Validate on a replica."],
  recommendations: [
    {
      title: "Refresh statistics",
      rationale: "Estimates are stale.",
      risk: "low" as const,
      confidence: 0.9,
      validationSteps: ["ANALYZE the table", "Capture a new plan"],
      migrationSql: null,
    },
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/advisor/context?"))
        return json({
          ready: true,
          source: {
            key: "local",
            label: "Local PostgreSQL",
            database: "index_analyzer",
          },
          sourceDatabaseId: 1,
          selection: { queryId: "314" },
          evidence: {
            queryOrigin: "live",
            historySamples: 4,
            planMatch: "query-shape",
            tables: ["sales.orders"],
            indexes: 3,
            settings: 24,
          },
          omissions: ["No statistics existed for one column."],
          input: {
            source: "local",
            query: "SELECT * FROM sales.orders WHERE id = $1",
            plan: [{ Plan: { "Node Type": "Index Scan" } }],
            tables: [],
            indexes: [],
            settings: {},
            statistics: { "query.calls": 12 },
            context: {
              database: "index_analyzer",
              sourceLabel: "Local PostgreSQL",
              queryId: "314",
            },
            sourceDatabaseId: 1,
          },
        });
      if (url === "/api/advisor") {
        const request = JSON.parse(String(init?.body)) as { submit?: boolean };
        const preview = {
          payload: { query: "SELECT * FROM sales.orders WHERE id = ?" },
          preview:
            '{\n  "query": "SELECT * FROM sales.orders WHERE id = [REDACTED_UUID]"\n}',
          bytes: 82,
          limitBytes: 131_072,
          truncated: false,
          omissions: [],
          canSubmit: true,
          model: "test-model",
        };
        return json(
          request.submit
            ? {
                preview,
                analysis,
                metadata: {
                  model: "test-model",
                  providerRequestId: "req_test",
                },
              }
            : { preview },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AdvisorWorkspace", () => {
  it("previews selected evidence and preserves its source and analysis mode", async () => {
    const user = userEvent.setup();
    render(
      createElement(AdvisorWorkspace, {
        sourceKey: "local",
        queryId: "314",
      }),
    );
    expect(
      await screen.findByTestId("advisor-context-summary"),
    ).toHaveTextContent(/4 history samples/i);
    expect(screen.getByTestId("advisor-context-summary")).toHaveTextContent(
      /no statistics existed/i,
    );
    await user.click(screen.getByRole("button", { name: /deep analysis/i }));
    expect(screen.getByRole("button", { name: /deep analysis/i })).toHaveClass(
      "active",
    );

    await user.click(screen.getByRole("button", { name: /preview payload/i }));
    expect(
      screen.getByText(/exactly what will be transmitted/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED_UUID\]/i)).toBeInTheDocument();
    expect(screen.getByText(/0 result rows/i)).toBeInTheDocument();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/advisor/context?source=local&queryId=314",
      { cache: "no-store" },
    );
    const advisorCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/advisor",
    );
    expect(JSON.parse(String(advisorCall?.[1]?.body))).toMatchObject({
      source: "local",
      query: "SELECT * FROM sales.orders WHERE id = $1",
      mode: "deep",
    });
  });

  it("surfaces a structured result after analysis", async () => {
    const user = userEvent.setup();
    render(
      createElement(AdvisorWorkspace, {
        sourceKey: "local",
        queryId: "314",
      }),
    );
    await screen.findByTestId("advisor-context-summary");
    await user.click(
      screen.getByRole("button", { name: /analyze selected evidence/i }),
    );
    expect(
      await screen.findByText(/workload shift invalidated/i),
    ).toBeInTheDocument();
  });

  it("never substitutes demo or unrelated workload data without a selection", async () => {
    render(createElement(AdvisorWorkspace, { sourceKey: "local" }));
    expect(
      screen.getByText(/no demo query or unrelated top statement/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("reopens a saved structured analysis without another provider request", async () => {
    const user = userEvent.setup();
    render(
      createElement(AdvisorWorkspace, {
        analyses: [
          {
            id: "saved-1",
            title: analysis.summary,
            queryId: "314",
            model: "test-model",
            createdAt: "2m ago",
            severity: "critical",
            confidence: 94,
            summary: analysis.summary,
            requestId: "req_saved",
            tokens: 321,
            result: {
              ...analysis,
              evidence: [
                {
                  claim: "A sequential scan removed 10,000 rows.",
                  source: "plan",
                  reference: "Plan.0",
                },
              ],
              recommendations: [
                {
                  title: "Refresh statistics",
                  rationale: "Estimates are stale.",
                  risk: "low",
                  confidence: 0.9,
                  validationSteps: ["ANALYZE the table", "Capture a new plan"],
                  migrationSql: "ANALYZE sales.orders;",
                },
              ],
            },
          },
        ],
        sourceKey: "local",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /workload shift invalidated/i }),
    );
    expect(
      screen.getByRole("heading", { name: "Saved analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/removed 10,000 rows/i)).toBeInTheDocument();
    expect(screen.getByText("ANALYZE sales.orders;")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
