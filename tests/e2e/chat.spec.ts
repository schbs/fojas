import { expect, test } from "@playwright/test";
import { MARCA, preguntar, revisarAccesibilidad } from "./ayudas";

test("pregunta respondible: respuesta con al menos una cita que abre el PDF en la página citada", async ({ page }) => {
  await page.goto("/");
  await preguntar(page, `¿Hasta qué día tengo para mandar los comprobantes del mes? ${MARCA}`);
  const fuentes = page.getByRole("complementary", { name: "Fuentes de la foja 1" });
  await expect(fuentes).toBeVisible();
  const citas = fuentes.getByRole("button");
  expect(await citas.count()).toBeGreaterThanOrEqual(1);
  await expect(citas.first()).toContainText("p.");
  await revisarAccesibilidad(page, "/ con una respuesta citada");

  await citas.first().click();
  const visor = page.getByRole("dialog");
  await expect(visor).toBeVisible();
  await expect(visor.getByText("· la citada")).toBeVisible();
  await expect(visor.locator(".resaltado-pdf").first()).toBeAttached();
  await revisarAccesibilidad(page, "visor del PDF");
  await visor.getByRole("button", { name: "Cerrar" }).click();
  await expect(visor).toBeHidden();
});

test("pregunta no respondible: muestra la derivación a un contador", async ({ page }) => {
  await page.goto("/");
  await preguntar(page, `¿Cuánto sale una pizza grande en el centro de Neuquén? ${MARCA}`);
  await expect(page.getByText("Derivada a un contador")).toBeVisible();
  await expect(page.getByText("No encuentro eso en los documentos del estudio; lo derivo a un contador.")).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});

test("pregunta demasiado corta: avisa sin llamar al asistente", async ({ page }) => {
  await page.goto("/");
  await preguntar(page, "ok");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("al menos 3 caracteres");
  await expect(page.getByRole("article")).toHaveCount(0);
});
