import { expect, test } from "@playwright/test";
import { entrarAlPanel, revisarAccesibilidad } from "./ayudas";

for (const ruta of ["/", "/admin", "/en", "/en/admin"]) {
  test(`axe sin violaciones graves: ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await revisarAccesibilidad(page, ruta);
  });
}

test("axe sin violaciones graves: /admin con sesión y fragmentos a la vista", async ({ page }) => {
  await entrarAlPanel(page);
  await page.getByRole("link", { name: /^Ver fragmentos de/ }).first().click();
  await expect(page.getByRole("heading", { name: /^Fragmentos de/ })).toBeVisible();
  await revisarAccesibilidad(page, "/admin con sesión");
});
