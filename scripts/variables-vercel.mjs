// Arma un archivo con SOLO las variables que necesita el sitio en Vercel, para que Germán lo importe en
// Settings → Environment Variables → "Import .env" (o lo arrastre ahí). No muestra ningún valor.
// Uso: node scripts/variables-vercel.mjs   → crea .env.vercel (ignorado por git y por Vercel). Borrarlo después.
//      node scripts/variables-vercel.mjs --borrar   → lo borra (después de importarlo en Vercel).
import fs from "node:fs";

if (process.argv.includes("--borrar")) {
  fs.rmSync(".env.vercel", { force: true });
  console.log(fs.existsSync(".env.vercel") ? "No se pudo borrar." : "Borrado: el archivo de variables para Vercel ya no está.");
  process.exit(0);
}

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error("No hay variables locales cargadas.");
  process.exit(1);
}

const PARA_VERCEL = ["GEMINI_API_KEY", "GEMINI_MODEL", "SUPABASE_URL", "SUPABASE_SECRET_KEY"];

const lineas = [];
for (const n of PARA_VERCEL) {
  const v = process.env[n]?.trim();
  if (v) lineas.push(`${n}=${v}`);
  console.log(`${v ? "va   " : "vacía"}  ${n}`);
}
fs.writeFileSync(".env.vercel", lineas.join("\n") + "\n");
console.log("\nListo: .env.vercel (no se sube a git ni a Vercel). Borralo después de cargarlo.");
