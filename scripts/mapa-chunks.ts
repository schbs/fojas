// Lista los chunks del corpus (documento, página, sección y comienzo del texto), sin red ni cuota.
// Sirve para armar data/eval/golden.json con el documento y la página esperados.
// Uso: npx tsx scripts/mapa-chunks.ts
import { chunkear } from "../src/ingesta/chunking";
import { cargarCorpus } from "../src/ingesta/corpus";
import { leerPdf } from "../src/ingesta/pdf";

async function main() {
  for (const archivo of cargarCorpus()) {
    for (const c of chunkear(await leerPdf(archivo.datos))) console.log(`${archivo.slug} p${c.pagina} · ${c.seccion} · ${c.contenido.replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

void main();
