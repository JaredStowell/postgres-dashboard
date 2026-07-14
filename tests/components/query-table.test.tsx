import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryTable } from "@/components/queries/query-table";
import { queries } from "@/lib/demo/data";

afterEach(cleanup);

describe("QueryTable", () => {
  it("filters normalized SQL across query metadata", async () => {
    const user = userEvent.setup();
    render(createElement(QueryTable, { queries }));
    expect(
      screen.getByText(/5 loaded queries · API limit 250/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: /search queries/i }),
      "audit.events",
    );
    expect(
      screen.getByText(/SELECT tenant_id, event_type/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
  });

  it("narrows to regressions and exposes an empty recovery state", async () => {
    const user = userEvent.setup();
    render(createElement(QueryTable, { queries }));
    await user.click(screen.getByRole("button", { name: /regressed/i }));
    expect(screen.getAllByText("regressed")).toHaveLength(2);

    await user.type(
      screen.getByRole("textbox", { name: /search queries/i }),
      "no-such-query",
    );
    expect(
      screen.getByRole("heading", { name: /no matching queries/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText(/inventory_reservations/i)).toBeInTheDocument();
  });
});
