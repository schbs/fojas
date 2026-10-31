// Ingesta del corpus con embeddings reales de Gemini. Con SUPABASE_URL y SUPABASE_SECRET_KEY guarda en Supabase
// (pgvector); sin ellas, en memoria (sirve para medir sin cuenta). Imprime el resumen y una consulta de ejemplo.
// Uso: npm run ingestar                       (≈ 70 pedidos de embeddings la primera vez; 0 si nada cambió)
//      npm run ingestar -- "¿pregunta?"       (consulta de ejemplo propia)
import { crearAlmacenMemoria } from "../src/almacen/memoria";
import { crearAlmacenSupabase } from "../src/almacen/supabase";
import { crearEmbeddingsGemini } from "../src/ia/embeddings";
import { cargarCorpus } from "../src/ingesta/corpus";
import { ingestar } from "../src/ingesta/ingestar";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: falla abajo con un mensaje claro
}
if (!process.env.GEMINI_API_KEY) {
  console.error("Falta GEMINI_API_KEY (npm run check-env).");
  process.exit(1);
}

async function main() {
  const conSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const almacen = conSupabase ? crearAlmacenSupabase({ url: process.env.SUPABASE_URL!, clave: process.env.SUPABASE_SECRET_KEY! }) : crearAlmacenMemoria();
  const embeddings = crearEmbeddingsGemini({ apiKey: process.env.GEMINI_API_KEY!, pausaMs: 300 });
  const t0 = Date.now();
  const r = await ingestar(cargarCorpus(), almacen, embeddings);
  const conteo = await almacen.contar();
  console.log(`Almacén: ${almacen.nombre} · embeddings: ${embeddings.nombre} (${embeddings.dimensiones} dimensiones)`);
  console.log(`${conteo.documentos} documentos, ${conteo.chunks} chunks, ${conteo.hashesRepetidos} duplicados`);
  console.log(`Esta corrida: ${r.chunksNuevos} chunks nuevos, ${r.chunksBorrados} borrados, ${r.sinCambios} documentos sin cambios, ${r.duplicadosEvitados} duplicados evitados, ${r.embeddingsPedidos} embeddings pedidos (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  const pregunta = process.argv[2] ?? "¿Hasta cuándo puedo cancelar un turno sin que me cuente como consulta?";
  const [q] = await embeddings.embeber([pregunta], "RETRIEVAL_QUERY");
  const resultados = await almacen.buscar(q, { k: 3, minSimilitud: 0.5 });
  console.log(`\nConsulta: "${pregunta}"`);
  for (const x of resultados) console.log(`  ${x.similitud.toFixed(3)}  ${x.titulo}, página ${x.pagina} · ${x.seccion}`);
  if (!resultados.length) console.log("  (nada por encima del umbral de 0,5)");
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
