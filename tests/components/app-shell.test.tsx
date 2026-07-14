import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/app-shell";

afterEach(cleanup);

describe("AppShell", () => {
  it("provides database context, primary navigation, and keyboard commands", async () => {
    const user = userEvent.setup();
    render(
      createElement(AppShell, null, createElement("main", null, "Page body")),
    );
    expect(
      screen.getByRole("navigation", { name: /primary/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /database/i })).toHaveValue(
      "commerce_prod",
    );

    await user.keyboard("{Meta>}k{/Meta}");
    expect(
      screen.getByRole("dialog", { name: /command menu/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open explain lab/i }),
    ).toHaveAttribute("href", "/plans");
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: /command menu/i }),
    ).not.toBeInTheDocument();
  });
});
