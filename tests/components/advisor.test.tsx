import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";

const analysis = {
  summary: "The workload shift invalidated the planner assumption.",
  severity: "high",
  confidence: 0.94,
  evidence: [],
  caveats: ["Validate on a replica."],
  recommendations: [
    {
      title: "Refresh statistics",
      rationale: "Estimates are stale.",
      risk: "low",
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
      if (url.startsWith("/api/queries"))
        return json({
          queries: [{ query: "SELECT * FROM orders WHERE id = $1" }],
        });
      if (url.startsWith("/api/indexes")) return json({ indexes: [] });
      if (url.startsWith("/api/health"))
        return json({
          database: "index_analyzer",
          sourceDatabaseId: 1,
          capabilities: { settings: {} },
        });
      if (url === "/api/advisor") {
        const request = JSON.parse(String(init?.body)) as { submit?: boolean };
        const preview = {
          payload: { query: "SELECT * FROM orders WHERE id = ?" },
          preview:
            '{\n  "query": "SELECT * FROM orders WHERE id = [REDACTED_UUID]"\n}',
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
  it("previews the exact sanitized payload and supports analysis modes", async () => {
    const user = userEvent.setup();
    render(createElement(AdvisorWorkspace));
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
  });

  it("surfaces a structured result after analysis", async () => {
    const user = userEvent.setup();
    render(createElement(AdvisorWorkspace));
    await user.click(
      screen.getByRole("button", { name: /analyze checkout query/i }),
    );
    expect(
      await screen.findByText(/workload shift invalidated/i),
    ).toBeInTheDocument();
  });
});
