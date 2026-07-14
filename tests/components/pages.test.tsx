import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FleetPage } from "@/components/pages/fleet-page";
import { MaintenancePage } from "@/components/pages/maintenance-page";

afterEach(cleanup);

describe("primary pages", () => {
  it("renders evidence-oriented fleet health", () => {
    render(createElement(FleetPage));
    expect(
      screen.getByRole("heading", { name: /database needs attention/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText(/pg_stat_statements/i)).toBeInTheDocument();
  });

  it("renders maintenance risks and copy-only guidance", () => {
    render(createElement(MaintenancePage));
    expect(
      screen.getByRole("heading", { name: "Maintenance" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("audit.events")).toHaveLength(3);
    expect(screen.getByText(/review only/i)).toBeInTheDocument();
  });
});
