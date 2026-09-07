import { expect, test } from "@playwright/test";

test.describe("sync setup", () => {
  test("saves the OAuth client and shows per-profile state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await expect(page.locator(".sync-button")).toHaveText("☁ off");

    await page.locator(".sync-button").click();
    const dialog = page.locator(".modal");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3").first()).toContainText("missing");
    await expect(dialog.locator(".profile-sync")).toHaveCount(2);
    await expect(dialog.locator('[data-profile="work"] button')).toBeDisabled();

    await dialog.locator('input[placeholder$="googleusercontent.com"]').fill("123-abc.apps.googleusercontent.com");
    await dialog.locator('input[type="password"]').fill("GOCSPX-secret");
    await dialog.getByRole("button", { name: "Save client" }).click();
    await expect(page.locator(".toast")).toContainText("Google client saved");
    await expect(dialog.locator("h3").first()).toContainText("configured");
    await expect(dialog.locator('[data-profile="work"] button')).toBeEnabled();

    await dialog.locator('[data-profile="work"] button').click();
    await expect(page.locator(".toast")).toContainText("only available in the desktop app");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.locator(".sync-button").click();
    await expect(page.locator(".modal h3").first()).toContainText("configured");
  });
});
