// Busca claves reales en todo el historial de git de esta carpeta (no solo en los archivos actuales).
// Primero la búsqueda amplia del plan (nombres como "token" o "secret" aparecen en el código y la documentación);
// después, patrones con la forma exacta de cada clave real. Nunca imprime un valor: solo dónde está.
// Uso: node scripts/buscar-secretos-historial.mjs
import { execFileSync } from "node:child_process";

const historial = execFileSync("git", ["log", "-p", "--all", "--no-color", "--", "."], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const lineas = historial.split("\n").filter((l) => /^[+-](?![+-])/.test(l));

const amplia = lineas.filter((l) => /(api[_-]?key|secret|token|sk-|AIza)/i.test(l));
console.log(`Búsqueda amplia (api_key|secret|token|sk-|AIza): ${amplia.length} líneas que mencionan esas palabras.`);

const PATRONES = {
  "Google / Gemini (AIza + 35)": /AIza[0-9A-Za-z_-]{35}/,
  // Formato nuevo de las claves de AI Studio (2026). secretlint todavía no lo reconoce.
  "Google AI Studio (AQ.)": /AQ\.[0-9A-Za-z_-]{40,}/,
  "Supabase secreta (sb_secret_)": /sb_secret_[0-9A-Za-z_-]{20,}/,
  "Supabase publicable (sb_publishable_)": /sb_publishable_[0-9A-Za-z_-]{20,}/,
  "JWT (service_role / anon viejas)": /eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}/,
  "Meta (EAA…)": /EAA[0-9A-Za-z]{60,}/,
  "Groq (gsk_)": /gsk_[0-9A-Za-z]{40,}/,
  "Clave privada PEM con contenido": /BEGIN PRIVATE KEY-----\\n[0-9A-Za-z+/]{40,}/,
  "OpenAI / Anthropic (sk-)": /sk-[0-9A-Za-z_-]{30,}/,
};

// Control: --control prueba los mismos patrones contra .env.local (que tiene las claves reales) para confirmar que
// detectan. Solo dice "detecta" o "no detecta" por patrón.
if (process.argv.includes("--control")) {
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(".env.local", "utf8");
  for (const [nombre, patron] of Object.entries(PATRONES)) console.log(`${patron.test(env) ? "detecta   " : "no detecta"}  ${nombre}`);
  process.exit(0);
}

// También los archivos de hoy que todavía no están en ningún commit (sin .env.local, que no se publica).
const { readFileSync } = await import("node:fs");
const archivos = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.endsWith(".env.local") && !/\.(png|jpg|ico)$/.test(f));
const actuales = archivos.flatMap((f) => {
  try {
    return readFileSync(f, "utf8").split("\n");
  } catch {
    return [];
  }
});

let reales = 0;
for (const [nombre, patron] of Object.entries(PATRONES)) {
  const enHistorial = lineas.filter((l) => patron.test(l)).length;
  const enArchivos = actuales.filter((l) => patron.test(l)).length;
  reales += enHistorial + enArchivos;
  console.log(`${enHistorial + enArchivos ? "✗" : "✓"} ${nombre}: historial ${enHistorial}, archivos actuales ${enArchivos}`);
}
console.log(reales ? `\n✗ ${reales} posibles claves reales en el historial: revisar antes de publicar.` : "\n✓ Ninguna clave real en el historial: lo que encuentra la búsqueda amplia son nombres de variables y textos.");
process.exit(reales ? 1 : 0);
