// Arma el .env.local de Fojas sin mostrar ningún valor: copia las claves compartidas que ya existen (Gemini, de
// TurnoListo) y deja vacías las que tiene que cargar Germán (Supabase). No pisa variables que ya estén cargadas.
// Uso: node scripts/copiar-claves.mjs
import fs from "node:fs";
import path from "node:path";

const DESTINO = ".env.local";
const ORIGEN = path.join("..", "turnolisto", ".env.local");
const COMPARTIDAS = ["GEMINI_API_KEY", "GEMINI_MODEL"];

const leer = (archivo) => {
  const valores = {};
  if (!fs.existsSync(archivo)) return valores;
  for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) valores[m[1]] = m[2];
  }
  return valores;
};

const actuales = leer(DESTINO);
const origen = leer(ORIGEN);
const nombres = fs
  .readFileSync(".env.example", "utf8")
  .split(/\r?\n/)
  .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

const salida = {};
for (const n of nombres) {
  if (actuales[n]) salida[n] = actuales[n];
  else if (COMPARTIDAS.includes(n) && origen[n]) salida[n] = origen[n];
  else salida[n] = "";
}
fs.writeFileSync(DESTINO, Object.entries(salida).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
for (const n of nombres) console.log(`${salida[n] ? "OK   " : "FALTA"}  ${n}`);
