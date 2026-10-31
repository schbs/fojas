import { expect, test } from "@playwright/test";
import { MARCA, revisarAccesibilidad } from "./ayudas";

async function ask(page: import("@playwright/test").Page, pregunta: string) {
  await page.getByLabel("Your question").fill(pregunta);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test("en inglés: responde en inglés y cita el documento (en español) en la página exacta", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await ask(page, `How far in advance can I cancel an appointment at no cost? ${MARCA}`);
  const fuentes = page.getByRole("complementary", { name: "Sources for folio 1" });
  await expect(fuentes).toBeVisible();
  await expect(fuentes.getByRole("button").first()).toContainText("Política de turnos");
  await expect(page.getByRole("article").getByText(/hours/i).first()).toBeVisible();
  await revisarAccesibilidad(page, "/en con una respuesta citada");

  await fuentes.getByRole("button").first().click();
  const visor = page.getByRole("dialog");
  await expect(visor.getByText("Quoted sentence (in Spanish):")).toBeVisible();
  await expect(visor.getByText("· the cited page")).toBeVisible();
  await visor.getByRole("button", { name: "Close" }).click();
});

test("en inglés: una pregunta fuera de los documentos se deriva en inglés", async ({ page }) => {
  await page.goto("/en");
  await ask(page, `What is the standard VAT rate? ${MARCA}`);
  await expect(page.getByText("Passed to an accountant")).toBeVisible();
  await expect(page.getByText("I can't find that in the firm's documents; I'm passing your question to an accountant.")).toBeVisible();
});

test("el enlace de idioma lleva de una versión a la otra", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask the firm, with the source in the margin");
  await page.getByRole("link", { name: "Admin" }).click();
  await page.getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Panel del estudio");
});
