import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvisorWorkspace } from "@/components/advisor/advisor-workspace";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    expect(screen.getByRole("button", { name: /analyzing/i })).toBeDisabled();
    expect(
      await screen.findByText(/workload shift invalidated/i),
    ).toBeInTheDocument();
  });
});
