import { test, expect } from "@playwright/test";

test("landing loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ruh-roh. halp.")).toBeVisible();
});
