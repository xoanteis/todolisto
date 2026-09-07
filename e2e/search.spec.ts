import { expect, test } from "@playwright/test";

test.describe("search", () => {
  test("finds notes across sessions ignoring accents, jumps to them, and scopes to the open session", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeFocused();

    await page.keyboard.type("Reunión con María sobre el presupuesto #todo");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Idea: cache por tenant #idea");
    await expect(page.locator(".session-status")).toContainText("2 entries");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".session-row")).toHaveCount(1);

    await editor.click();
    await page.keyboard.type("Kickoff with ACME about the budget");
    await expect(page.locator(".session-status")).toContainText("1 entry");

    await page.keyboard.press("Control+Shift+F");
    const panel = page.locator(".search-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".search-input")).toBeFocused();
    await page.keyboard.type("reunion maria");
    await expect(panel.locator(".hit")).toHaveCount(1);
    await expect(panel.locator(".hit mark")).toHaveCount(2);
    await expect(panel.locator(".hit-meta")).toContainText("Session");
    await expect(panel.locator(".count")).toHaveText("1 result");

    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
    const target = page.locator(".session-body .entry[data-entry-id]").first();
    await expect(target).toBeVisible();
    await expect(target).toContainText("Reunión con María");
    await expect(target).toHaveClass(/flash/);

    await page.locator(".search-button").click();
    await page.keyboard.type("#todo");
    await expect(panel.locator(".hit")).toHaveCount(1);
    await expect(panel.locator(".hit-meta")).toContainText("#todo");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(editor).toBeFocused();

    await page.keyboard.press("Control+F");
    await expect(panel.locator(".scope button.active")).toHaveText("This session");
    await page.keyboard.type("budget");
    await expect(panel.locator(".hit")).toHaveCount(1);
    await expect(panel.locator(".hit-meta")).toContainText("open session");
    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(editor).toBeFocused();
    await expect(editor.locator(".entry").first()).toHaveClass(/flash/);
  });
});
