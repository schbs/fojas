import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const DIR_E2E = path.join(process.cwd(), "test-results", "e2e-datos");
export const PDF_PRUEBA = path.join(DIR_E2E, "politica-de-mascotas.pdf");
export const TITULO_PRUEBA = "Política de mascotas (e2e)";
export const SLUG_PRUEBA = "subido-politica-de-mascotas-e2e";
/** Las consultas de los e2e llevan esta marca: así limpiar.ts borra solo esas filas de unanswered. */
export const MARCA = "[e2e]";

/** axe con reglas WCAG 2.1 AA: no tiene que haber violaciones serias ni críticas. */
export async function revisarAccesibilidad(page: Page, nombre: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(`  axe → ${nombre}: ${r.passes.length} reglas OK, ${r.violations.length} violaciones (${graves.length} serias o críticas)`);
  expect(graves.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

/** Usuario de demo del panel (lo crea scripts/crear-admin-demo.ts; el archivo no va a git). */
export function credencialesAdmin(): { email: string; password: string } | null {
  const archivo = path.join("data", "admin-demo.json");
  return fs.existsSync(archivo) ? (JSON.parse(fs.readFileSync(archivo, "utf8")) as { email: string; password: string }) : null;
}

export async function entrarAlPanel(page: Page) {
  const c = credencialesAdmin();
  expect(c, "Falta data/admin-demo.json: correr npm run admin:crear").not.toBeNull();
  await page.goto("/admin");
  await page.getByLabel("Email").fill(c!.email);
  await page.getByLabel("Contraseña").fill(c!.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(`Sesión de ${c!.email}`)).toBeVisible();
}

export async function preguntar(page: Page, pregunta: string) {
  await page.getByLabel("Tu consulta").fill(pregunta);
  await page.getByRole("button", { name: "Preguntar" }).click();
}
