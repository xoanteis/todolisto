import { expect, test } from "@playwright/test";

const TIME = /^\d\d:\d\d:\d\d$/;

test.describe("timestamped notes", () => {
  test("Enter keeps the entry, Shift+Enter starts a new stamped entry, and notes survive a reload", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();

    await page.keyboard.type("Kickoff with ACME");
    const entries = editor.locator(".entry");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toHaveAttribute("data-time", TIME);
    await expect(page.locator(".day-sep")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await page.keyboard.type("second line of the same entry");
    await expect(entries).toHaveCount(1);
    await expect(entries.first().locator("p")).toHaveCount(2);

    await page.keyboard.press("Shift+Enter");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(1)).toHaveAttribute("data-time", "");
    await page.keyboard.type("#todo Ask Maria for the numbers");
    await expect(entries.nth(1)).toHaveAttribute("data-time", TIME);

    await expect(page.locator(".session-status")).toContainText("2 entries");
    await expect(page.locator(".statusbar .status")).toContainText("2 entries");

    await page.reload();
    const reloaded = page.locator(".ProseMirror .entry");
    await expect(reloaded).toHaveCount(3);
    await expect(reloaded.first()).toContainText("Kickoff with ACME");
    await expect(reloaded.first().locator("p")).toHaveCount(2);
    await expect(reloaded.nth(1)).toContainText("#todo Ask Maria");
    await expect(reloaded.nth(2)).toHaveAttribute("data-time", "");
    await expect(page.locator(".ProseMirror")).toBeFocused();
  });

  test("Ctrl+Enter ends the session, Ctrl+Shift+Enter reopens it, profiles are separate", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Decision: ship on Friday");
    await expect(page.locator(".session-status")).toContainText("1 entry");

    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".toast")).toContainText("Session ended");
    await expect(page.locator(".session-row")).toHaveCount(1);
    await expect(page.locator(".session-row .title")).toHaveText("Decision: ship on Friday");
    await expect(page.locator(".session-status")).toHaveText("No open session");
    await expect(editor.locator(".entry")).toHaveCount(1);

    await page.locator(".session-row").click();
    await expect(page.locator(".session-body .entry")).toHaveCount(1);
    await expect(page.locator(".session-body .entry")).toHaveAttribute("data-time", TIME);

    await page.locator(".profile-select").selectOption("personal");
    await expect(page.locator(".session-row")).toHaveCount(0);
    await page.locator(".profile-select").selectOption("work");
    await expect(page.locator(".session-row")).toHaveCount(1);

    await editor.click();
    await page.keyboard.press("Control+Shift+Enter");
    await expect(page.locator(".toast")).toContainText("Reopened");
    await expect(page.locator(".session-row")).toHaveCount(0);
    await expect(editor.locator(".entry")).toHaveCount(2);
    await expect(editor.locator(".entry").first()).toContainText("Decision: ship on Friday");
    await expect(page.locator(".session-status")).toContainText("1 entry");
  });
});
