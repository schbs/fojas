import { expect, test } from "@playwright/test";
import { entrarAlPanel, MARCA, PDF_PRUEBA, preguntar, TITULO_PRUEBA } from "./ayudas";

test.describe.configure({ mode: "serial" });

test("datos incorrectos: el panel no deja entrar", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email").fill("admin-demo@example.com");
  await page.getByLabel("Contraseña").fill("no-es-la-contraseña");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("no son correctos");
  await expect(page.getByRole("heading", { name: "Subir un documento" })).toHaveCount(0);
});

test("subir un PDF nuevo lo vuelve consultable (y se puede borrar)", async ({ page }) => {
  const pregunta = `¿Puedo ir a la oficina del estudio con mi perro? ${MARCA}`;

  // Antes: los documentos del estudio no hablan de mascotas.
  await page.goto("/");
  await preguntar(page, pregunta);
  await expect(page.getByText("Derivada a un contador")).toBeVisible();

  // Subida desde el panel.
  await entrarAlPanel(page);
  await page.getByLabel("Título del documento").fill(TITULO_PRUEBA);
  await page.getByLabel("Archivo PDF (hasta 4 MB)").setInputFiles(PDF_PRUEBA);
  await page.getByRole("button", { name: "Subir e indexar" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("ya se puede consultar");
  await expect(page.getByRole("rowheader", { name: new RegExp(TITULO_PRUEBA.replace(/[()]/g, "\\$&")) })).toBeVisible();

  // Sus fragmentos se ven en el panel.
  await page.getByRole("link", { name: `Ver fragmentos de ${TITULO_PRUEBA}` }).click();
  await expect(page.getByRole("heading", { name: `Fragmentos de “${TITULO_PRUEBA}”`, exact: false })).toBeVisible();

  // Después: la misma pregunta se responde citando el documento nuevo.
  await page.goto("/");
  await preguntar(page, pregunta);
  const fuentes = page.getByRole("complementary", { name: "Fuentes de la foja 1" });
  await expect(fuentes).toBeVisible();
  await expect(fuentes.getByRole("button").filter({ hasText: TITULO_PRUEBA })).toHaveCount(1);

  // La pregunta sin respuesta de antes quedó registrada para el estudio.
  await page.goto("/admin");
  await expect(page.getByText(pregunta)).toBeVisible();

  // Reingestar un documento sin cambios no duplica nada.
  await page.getByRole("button", { name: `Reingestar ${TITULO_PRUEBA}` }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("0 fragmento(s) nuevos y 0 borrados");

  // Limpieza desde el panel.
  await page.getByRole("button", { name: `Borrar ${TITULO_PRUEBA}` }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Se borró");
  await expect(page.getByRole("rowheader", { name: new RegExp(TITULO_PRUEBA.replace(/[()]/g, "\\$&")) })).toHaveCount(0);
});
