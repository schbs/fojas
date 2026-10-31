// Dice OK/FALTA por cada variable de .env.example, sin mostrar ningún valor.
// Lee .env.local con process.loadEnvFile (si no existe, todo da FALTA).
import fs from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.log("(no hay .env.local todavía)");
}

const nombres = fs
  .readFileSync(".env.example", "utf8")
  .split(/\r?\n/)
  .map((linea) => linea.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

let faltan = 0;
for (const nombre of nombres) {
  const ok = Boolean(process.env[nombre]?.trim());
  if (!ok) faltan++;
  console.log(`${ok ? "OK   " : "FALTA"}  ${nombre}`);
}
console.log(`\n${nombres.length - faltan}/${nombres.length} variables cargadas.`);
