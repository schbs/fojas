// Revisa la forma de SUPABASE_URL (dominio y ruta) y la deja solo en https://<ref>.supabase.co si trae una ruta de más.
// Uso: node scripts/revisar-url.mjs
import fs from "node:fs";

const ARCHIVO = ".env.local";
process.loadEnvFile(ARCHIVO);
const url = new URL(process.env.SUPABASE_URL ?? "");
const ok = /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname);
console.log(`dominio de Supabase: ${ok ? "sí" : "NO"} · ruta: "${url.pathname}"`);
if (ok && url.pathname !== "/") {
  const limpio = `${url.protocol}//${url.hostname}`;
  const texto = fs.readFileSync(ARCHIVO, "utf8").replace(/^SUPABASE_URL=.*$/m, `SUPABASE_URL=${limpio}`);
  fs.writeFileSync(ARCHIVO, texto);
  console.log("Se sacó la ruta: quedó solo el dominio del proyecto.");
}
