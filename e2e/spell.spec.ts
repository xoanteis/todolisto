import { expect, test } from "@playwright/test";

// The dictionaries load in a worker; give the first check generous time.
const READY = { timeout: 30_000 };

test.describe("spelling", () => {
  test("underlines misspellings in three languages, suggests, adds to the dictionary and autocorrects", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeFocused();
    await expect(page.locator(".spell-status")).toHaveAttribute("data-status", "ready", READY);

    await page.keyboard.type("Kickoff wrold with ACME about the reunión and the orsamento #todo ");
    const wrong = editor.locator(".misspelled");
    await expect(wrong).toHaveCount(2, READY);
    await expect(wrong.nth(0)).toHaveText("wrold");
    await expect(wrong.nth(1)).toHaveText("orsamento");

    await wrong.nth(0).click({ button: "right" });
    const menu = page.locator(".suggestions");
    await expect(menu).toBeVisible();
    await expect(menu.locator("button.suggestion").first()).toHaveText("world", READY);
    await menu.getByRole("menuitem", { name: "world", exact: true }).click();
    await expect(editor).toContainText("Kickoff world with ACME");
    await expect(wrong).toHaveCount(1);

    await wrong.nth(0).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Add “orsamento” to dictionary" }).click();
    await expect(page.locator(".toast")).toContainText("added to the work dictionary");
    await expect(wrong).toHaveCount(0);

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("recieve it");
    await expect(editor).toContainText("receive it");
    await page.keyboard.type(" Recieve ");
    await expect(editor).toContainText("receive it Receive ");
    await page.keyboard.press("Backspace");
    await expect(editor).toContainText("receive it Recieve ");

    await page.reload();
    await expect(page.locator(".spell-status")).toHaveAttribute("data-status", "ready", READY);
    await expect(page.locator(".ProseMirror")).toContainText("orsamento");
    await expect(page.locator(".ProseMirror .misspelled")).toHaveCount(0, READY);
  });
});
