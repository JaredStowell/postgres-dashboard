import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingsPage } from "@/components/pages/findings-page";
import { IndexesPage } from "@/components/pages/indexes-page";
import { MaintenancePage } from "@/components/pages/maintenance-page";
import { QueryTable } from "@/components/queries/query-table";
import { demoRepository } from "@/lib/demo/data";
import type { QueryStat } from "@/lib/demo/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("inventory workflows", () => {
  it("pages query results through the bounded API and preserves context", async () => {
    const user = userEvent.setup();
    const nextQuery: QueryStat = {
      ...demoRepository.queries()[0]!,
      id: "next-42",
      query: "SELECT next_page FROM sales.orders",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          queryViews: [nextQuery],
          pagination: { hasMore: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(QueryTable, {
        queries: demoRepository.queries(),
        initialHasMore: true,
        source: "warehouse",
        schema: "sales",
      }),
    );
    expect(
      screen.getByRole("link", { name: /analyze query 8839172/i }),
    ).toHaveAttribute(
      "href",
      "/advisor?source=warehouse&schema=sales&queryId=8839172",
    );

    await user.click(screen.getByRole("button", { name: /next query page/i }));
    expect(await screen.findByText(/select next_page/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/queries\?.*offset=25.*source=warehouse/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("button", { name: /next query page/i }),
    ).toBeDisabled();
  });

  it("generates index candidate SQL through the review-only endpoint", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sql: 'CREATE INDEX CONCURRENTLY "candidate" ON "sales"."orders" ("customer_id");',
          executable: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(IndexesPage, {
        indexes: [
          {
            name: "orders_customer_idx",
            table: "orders",
            schema: "sales",
            size: "2 MB",
            scans: 0,
            type: "btree",
            status: "unused",
            writeCost: "medium",
            definition:
              "CREATE INDEX orders_customer_idx ON sales.orders USING btree (customer_id)",
            keyColumns: ["customer_id"],
          },
        ],
        sourceKey: "warehouse",
        schema: "sales",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /copy candidate sql/i }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX"),
      ),
    );
    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(request).toMatchObject({
      schema: "sales",
      table: "orders",
      columns: ["customer_id"],
    });
    expect(
      screen.getByRole("link", { name: /analyze with ai/i }),
    ).toHaveAttribute("href", expect.stringContaining("source=warehouse"));
  });

  it("copies the selected maintenance command without executing it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sql: 'VACUUM (ANALYZE) "audit"."events";',
          executable: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(MaintenancePage));

    await user.click(
      screen.getByRole("button", { name: /vacuum \+ analyze/i }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'VACUUM (ANALYZE) "audit"."events";',
      ),
    );
    expect(screen.getByText(/review only · copy only/i)).toBeInTheDocument();
  });

  it("selects findings in place and links their evidence to the advisor", async () => {
    const user = userEvent.setup();
    render(
      createElement(FindingsPage, {
        sourceKey: "warehouse",
        schema: "sales",
      }),
    );
    const items = screen
      .getAllByRole("link")
      .filter((link) => link.classList.contains("finding-item"));
    await user.click(items[1]!);
    expect(
      screen.getByRole("link", { name: /analyze with ai/i }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(
        /advisor\?source=warehouse&schema=sales&findingId=/,
      ),
    );
  });
});
