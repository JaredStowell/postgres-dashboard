import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanTree } from "@/components/plans/plan-tree";
import { plan } from "@/lib/demo/data";

afterEach(cleanup);

describe("PlanTree", () => {
  it("renders nested plan evidence and inspects a selected node", async () => {
    const user = userEvent.setup();
    render(createElement(PlanTree, { root: plan }));
    expect(
      screen.getByRole("button", { name: /Bitmap Heap Scan/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Bitmap Heap Scan/i }));
    const details = screen.getByLabelText(/selected plan node details/i);
    expect(details).toHaveTextContent("88.72 ms");
    expect(details).toHaveTextContent("4.5×");
  });
});
