import { expect, test } from "@playwright/test";

test.describe("session agent", () => {
  test("proposes items from tags when a session ends, applies them, and tracks to-dos", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeFocused();

    await page.keyboard.type("Kickoff with ACME about the migration");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("#todo Ask María for the Q4 budget");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Their API limit is 600 req/min #data");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("#q Do we need SSO on day one?");
    await expect(page.locator(".session-status")).toContainText("4 entries");
    await page.keyboard.press("Control+Enter");

    const banner = page.locator(".pending-banner");
    await expect(banner).toContainText("waiting for review");
    await expect(banner).toContainText("1 to-do proposed");
    await expect(page.locator(".agent-button")).toContainText("1 to review");
    await banner.getByRole("button", { name: "Review" }).click();

    const review = page.locator(".modal.review");
    await expect(review).toBeVisible();
    await expect(review.locator("h2")).toContainText("Review");
    await expect(review.locator('input[placeholder="Session title"]')).toHaveValue("Kickoff with ACME about the migration");
    await expect(review.locator('[data-category="todos"] .check')).toHaveCount(1);
    await expect(review.locator('[data-category="todos"] .check')).toContainText("Ask María for the Q4 budget");
    await expect(review.locator('[data-category="facts"] .check')).toContainText("Their API limit is 600 req/min");
    await expect(review.locator('[data-category="questions"] .check')).toHaveCount(1);
    await review.locator('[data-category="questions"] .check input').uncheck();
    await review.locator('input[placeholder="Session title"]').fill("ACME kickoff");
    await review.getByRole("button", { name: /^Apply/ }).click();
    await expect(page.locator(".toast")).toContainText("1 to-do added");
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    await expect(page.locator(".session-row .title")).toHaveText("ACME kickoff");
    await expect(page.locator(".digest-button")).toHaveText("To do 1");

    await editor.click();
    await page.keyboard.press("Control+T");
    const digest = page.locator(".modal.digest");
    await expect(digest).toBeVisible();
    await expect(digest.locator(".digest-item")).toHaveCount(1);
    await expect(digest.locator(".digest-item")).toContainText("Ask María for the Q4 budget");
    await digest.getByRole("tab", { name: /Facts/ }).click();
    await expect(digest.locator(".digest-item")).toContainText("600 req/min");
    await digest.getByRole("tab", { name: /Open questions/ }).click();
    await expect(digest.locator(".digest-item")).toHaveCount(0);
    await digest.getByRole("tab", { name: /To do/ }).click();
    await digest.locator(".digest-item input[type=checkbox]").click();
    await expect(digest.locator(".digest-item")).toHaveCount(0);
    await expect(page.locator(".digest-button")).toHaveText("To do");
    await page.keyboard.press("Escape");
    await expect(digest).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".digest-button")).toHaveText("To do");
    await expect(page.locator(".session-row .title")).toHaveText("ACME kickoff");
  });
});
