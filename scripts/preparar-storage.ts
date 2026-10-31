// Crea el bucket privado "documentos" en Supabase Storage (si no existe) y sube los 12 PDFs del corpus, para que el
// visor del chat los muestre en la página citada. Se puede correr de nuevo: los PDFs se reemplazan (upsert).
// Uso: npx tsx scripts/preparar-storage.ts
import { crearBucket } from "../src/almacen/archivos";
import { cargarCorpus } from "../src/ingesta/corpus";
import { archivosReales } from "../src/rag/dependencias";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: falla abajo con un mensaje claro
}

async function main() {
  const bucket = await crearBucket({ url: process.env.SUPABASE_URL ?? "", clave: process.env.SUPABASE_SECRET_KEY ?? "" });
  console.log(`Bucket "documentos": ${bucket === "creado" ? "creado" : "ya estaba"}`);
  const archivos = archivosReales();
  for (const a of cargarCorpus()) {
    await archivos.subir(a.slug, a.datos);
    console.log(`✓ ${a.slug}.pdf (${(a.datos.length / 1024).toFixed(0)} KB)`);
  }
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
