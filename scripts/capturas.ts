// Capturas del README y de los perfiles (1280×800): inicio, respuesta con citas, visor con la frase resaltada,
// derivación, panel y fragmentos de un documento. En español van a docs/capturas/ y en inglés a docs/capturas/en/ (las de Upwork).
// Uso: npm run build && npm run capturas            (las dos versiones; ≈ 2 llamadas al modelo por idioma)
//      npm run capturas -- en                       (solo inglés)
// Las consultas sin respuesta que crean las capturas se borran al final.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { TEXTOS, type Idioma } from "../src/i18n/textos";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: el panel no va a poder entrar y se avisa abajo
}

const PUERTO = 3203;
const BASE = `http://localhost:${PUERTO}`;
const BRAVE = process.env.BRAVE_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "BraveSoftware/Brave-Browser/Application/brave.exe");
const PREGUNTAS: Record<Idioma, { respondible: string; trampa: string }> = {
  es: { respondible: "¿Con cuánta anticipación puedo cancelar un turno sin costo?", trampa: "¿Cuál es la alícuota general de IVA?" },
  en: { respondible: "How far in advance can I cancel an appointment at no cost?", trampa: "What is the standard VAT rate?" },
};

const arriba = async () => {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
};

async function preguntar(page: Page, idioma: Idioma, pregunta: string) {
  const t = TEXTOS[idioma].chat;
  await page.getByLabel(t.tuConsulta).fill(pregunta);
  await page.getByRole("button", { name: t.preguntar, exact: true }).click();
}

async function capturar(page: Page, idioma: Idioma) {
  const t = TEXTOS[idioma];
  const dir = path.join("docs", "capturas", idioma === "en" ? "en" : "");
  fs.mkdirSync(dir, { recursive: true });
  const foto = (nombre: string) => page.screenshot({ path: path.join(dir, `${nombre}.png`) });

  await page.goto(`${BASE}${t.base || "/"}`);
  await foto("1-inicio");

  await preguntar(page, idioma, PREGUNTAS[idioma].respondible);
  const fuentes = page.getByRole("complementary", { name: t.chat.fuentesDe(1) });
  await fuentes.waitFor({ timeout: 60_000 });
  await page.getByRole("article").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await foto("2-respuesta-con-citas");

  await fuentes.getByRole("button").first().click();
  await page.locator(".resaltado-pdf").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForTimeout(800);
  await foto("3-visor-pdf");
  await page.getByRole("dialog").getByRole("button", { name: t.visor.cerrar }).click();

  // La trampa en una página nueva: así la derivación queda arriba y el formulario fijo no la tapa.
  await page.goto(`${BASE}${t.base || "/"}`);
  await preguntar(page, idioma, PREGUNTAS[idioma].trampa);
  await page.getByText(t.chat.derivada).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await foto("4-derivacion");

  const credenciales = path.join("data", "admin-demo.json");
  if (!fs.existsSync(credenciales)) return console.warn("Sin data/admin-demo.json: no se captura el panel (npm run admin:crear).");
  const c = JSON.parse(fs.readFileSync(credenciales, "utf8")) as { email: string; password: string };
  await page.goto(`${BASE}${t.base}/admin`);
  if (await page.getByLabel(t.panel.contrasena).isVisible()) {
    await page.getByLabel(t.panel.email).fill(c.email);
    await page.getByLabel(t.panel.contrasena).fill(c.password);
    await page.getByRole("button", { name: t.panel.entrar }).click();
    await page.getByText(t.panel.sesionDe(c.email)).waitFor();
  }
  await page.goto(`${BASE}${t.base}/admin`);
  await page.waitForTimeout(500);
  await foto("5-panel");
  await page.goto(`${BASE}${t.base}/admin?doc=04-politica-turnos#fragmentos`);
  await page.waitForTimeout(500);
  await foto("6-fragmentos");
}

/** Borra de unanswered las consultas trampa que acaban de registrar las capturas. */
async function limpiar() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) return;
  for (const { trampa } of Object.values(PREGUNTAS)) {
    await fetch(`${url}/rest/v1/unanswered?pregunta=eq.${encodeURIComponent(trampa)}`, { method: "DELETE", headers: { apikey: clave, Authorization: `Bearer ${clave}` } });
  }
}

async function main() {
  const idiomas: Idioma[] = process.argv[2] === "en" ? ["en"] : process.argv[2] === "es" ? ["es"] : ["es", "en"];
  let servidor: ChildProcess | null = null;
  if (!(await arriba())) {
    servidor = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PUERTO)], { stdio: "ignore" });
    for (let i = 0; i < 60 && !(await arriba()); i++) await new Promise((r) => setTimeout(r, 1000));
  }
  const navegador = await chromium.launch({ executablePath: BRAVE });
  try {
    for (const idioma of idiomas) {
      const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: TEXTOS[idioma].lang, reducedMotion: "reduce" });
      await capturar(await contexto.newPage(), idioma);
      await contexto.close();
      console.log(`✓ capturas ${idioma}`);
    }
  } finally {
    await navegador.close();
    await limpiar();
    if (servidor?.pid) {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(servidor.pid), "/T", "/F"], { stdio: "ignore" });
      else servidor.kill();
    }
  }
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
