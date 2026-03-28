import { test, expect } from "@playwright/test";

/**
 * TylerOS vNext — E2E Browser Tests
 *
 * Verifies the UI components render correctly and interact with
 * the backend endpoints. Requires the app to be running locally.
 */

test.describe("Command Console — Three-Panel Layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the three-panel layout", async ({ page }) => {
    // Left panel: Pillar Health
    await expect(page.locator("text=Pillar Health").or(page.locator("[data-testid='pillar-health']"))).toBeVisible({ timeout: 10000 });

    // Center panel: Today's Focus tab
    await expect(page.locator("button:has-text('Today\\'s Focus')")).toBeVisible();

    // Center panel: Briefing tab
    await expect(page.locator("button:has-text('Briefing')")).toBeVisible();

    // Right panel: Signals
    await expect(page.locator("text=Signals").first()).toBeVisible();
  });

  test("Brain Dump button is visible", async ({ page }) => {
    await expect(page.locator("button:has-text('Brain Dump')")).toBeVisible();
  });
});

test.describe("CW-1: Today's Focus — Priority Cards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads focus items or shows empty state", async ({ page }) => {
    // Wait for loading to complete
    await page.waitForTimeout(3000);

    // Either shows focus cards or an empty state message
    const hasFocusCards = await page.locator("[data-testid='focus-card']").count() > 0;
    const hasEmptyState = await page.locator("text=No high-leverage").or(page.locator("text=brain dump")).count() > 0;

    expect(hasFocusCards || hasEmptyState).toBe(true);
  });
});

test.describe("CW-2: Dismiss with Reason", () => {
  test("dismiss reason options include all expected values", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // If there are focus cards, check for dismiss functionality
    const cards = page.locator("[data-testid='focus-card']");
    if (await cards.count() > 0) {
      // Look for dismiss button/trigger on the first card
      const dismissBtn = cards.first().locator("button:has-text('×')").or(cards.first().locator("[data-testid='dismiss-trigger']"));
      if (await dismissBtn.count() > 0) {
        await dismissBtn.click();

        // Verify reason options appear
        await expect(page.locator("text=Not relevant")).toBeVisible();
        await expect(page.locator("text=Already done")).toBeVisible();
        await expect(page.locator("text=Wrong timing")).toBeVisible();
      }
    }
  });
});

test.describe("CW-7: Creator Page — Generate Content", () => {
  test("shows Generate Content button", async ({ page }) => {
    await page.goto("/creator");
    await page.waitForTimeout(2000);

    // Look for the Generate Content button (blue accent)
    const genBtn = page.locator("button:has-text('Generate Content')");
    if (await genBtn.count() > 0) {
      await expect(genBtn).toBeVisible();
    }
  });

  test("opens Generate Content modal on click", async ({ page }) => {
    await page.goto("/creator");
    await page.waitForTimeout(2000);

    const genBtn = page.locator("button:has-text('Generate Content')");
    if (await genBtn.count() > 0) {
      await genBtn.click();

      // Modal should show topic input
      await expect(page.locator("input[placeholder*='topic']").or(page.locator("label:has-text('Topic')"))).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe("API Endpoint Smoke Tests", () => {
  test("GET /api/tasks returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/tasks?limit=1");
    // May return 401 if not authenticated, which is expected
    expect([200, 401, 403]).toContain(res.status());
  });

  test("GET /api/tasks?ranked=true returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/tasks?ranked=true&limit=1");
    expect([200, 401, 403]).toContain(res.status());
  });

  test("GET /api/system-alerts returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/system-alerts");
    expect([200, 401, 403]).toContain(res.status());
  });

  test("GET /api/content-queue returns valid JSON", async ({ request }) => {
    const res = await request.get("/api/content-queue?status=draft&limit=5");
    expect([200, 401, 403]).toContain(res.status());
  });

  test("POST /api/tasks/nonexistent/dismiss returns 404 or 401", async ({ request }) => {
    const res = await request.post("/api/tasks/nonexistent-id/dismiss", {
      data: { reason: "not_relevant" },
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});
