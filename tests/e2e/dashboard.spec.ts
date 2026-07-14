import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pages = [
  ["/", /Your database/i],
  ["/queries", "Queries"],
  ["/plans", "EXPLAIN Lab"],
  ["/indexes", "Indexes"],
  ["/maintenance", "Maintenance"],
  ["/live", "Live activity"],
  ["/advisor", "AI Advisor"],
  ["/findings", "Findings"],
] as const;

test.describe("production dashboard", () => {
  for (const [path, heading] of pages) {
    test(`${path} renders real database state`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }).first(),
      ).toBeVisible();
      if (path !== "/plans") {
        await expect(page.getByText("Sample preview")).toHaveCount(0);
      }
      await expect(page.locator("body")).not.toContainText(
        "Unexpected server error",
      );
    });
  }

  test("target and schema selectors are discovered and preserve context", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Target" })).toHaveValue(
      "local",
    );
    if (testInfo.project.name !== "mobile") {
      await expect(
        page.getByRole("combobox", { name: "Database" }),
      ).toHaveValue("index_analyzer");
    }
    await expect(page.getByRole("combobox", { name: "Schema" })).toContainText(
      "sales",
    );
    await page.getByRole("combobox", { name: "Schema" }).selectOption("sales");
    await expect(page).toHaveURL(/schema=sales/);
    await expect(page.getByRole("link", { name: "Indexes" })).toHaveAttribute(
      "href",
      /source=local.*schema=sales/,
    );
  });

  test("keyboard command menu navigates to a workspace", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open command menu" });
    await page.keyboard.press("ControlOrMeta+K");
    const dialog = page.getByRole("dialog", { name: "Command menu" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Search commands" }),
    ).toBeFocused();
    await dialog
      .getByRole("textbox", { name: "Search commands" })
      .fill("vacuum");
    await expect(
      dialog.getByRole("link", { name: /Review vacuum maintenance/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: /Open EXPLAIN Lab/ }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: /Review vacuum maintenance/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("preloads a selected query into EXPLAIN Lab", async ({ page }) => {
    const response = await page.request.get(
      "/api/queries?limit=10&source=local&search=sales.orders",
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      queries: Array<{ queryId: string }>;
    };
    const queryId = body.queries[0]?.queryId;
    expect(queryId).toBeTruthy();
    await page.goto(
      `/plans?source=local&queryId=${encodeURIComponent(queryId ?? "")}`,
    );
    await expect(page.locator(".cm-content")).toContainText("sales.orders");
  });

  test("plain EXPLAIN and guarded ANALYZE execute and persist", async ({
    page,
  }) => {
    await page.goto("/plans?source=local&schema=sales");
    await expect(page.getByText("No plan has been executed")).toBeVisible();
    await page.getByRole("button", { name: "Run EXPLAIN" }).click();
    await expect(page.getByText(/EXPLAIN completed/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Plan run/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Export plan as JSON/ }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /Export plan as Markdown/ }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "ANALYZE" }).click();
    await expect(
      page.getByRole("alertdialog", { name: /Execute with EXPLAIN ANALYZE/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Run guarded ANALYZE/ }).click();
    await expect(page.getByText(/Guarded ANALYZE completed/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("advisor previews redacted evidence and returns structured mock analysis", async ({
    page,
  }) => {
    const queryResponse = await page.request.get(
      "/api/queries?limit=1&source=local",
    );
    expect(queryResponse.ok()).toBeTruthy();
    const queryBody = (await queryResponse.json()) as {
      queries: Array<{ queryId: string }>;
    };
    const queryId = queryBody.queries[0]?.queryId;
    expect(queryId).toBeTruthy();
    await page.goto(
      `/advisor?source=local&queryId=${encodeURIComponent(queryId ?? "")}`,
    );
    await page.getByRole("button", { name: /Preview payload/ }).click();
    await expect(
      page.getByRole("heading", { name: "Payload preview" }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/0 result rows/i)).toBeVisible();
    await page.getByRole("button", { name: /Analyze/ }).click();
    await expect(
      page.getByRole("heading", { name: "Fresh analysis" }),
    ).toBeVisible({
      timeout: 20_000,
    });
  });

  test("primary pages have no serious accessibility violations", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }).first(),
      ).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const material = results.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      );
      expect(material, `${path}: ${JSON.stringify(material, null, 2)}`).toEqual(
        [],
      );
    }
  });

  test("mobile navigation exposes every workspace", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile project only");
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "AI Advisor" })).toBeVisible();
    await page.getByRole("link", { name: "Live activity" }).click();
    await expect(
      page.getByRole("heading", { name: "Live activity" }),
    ).toBeVisible();
  });
});
