// Lista las últimas preguntas que el asistente no pudo responder (tabla unanswered de Supabase).
//   npx tsx scripts/sin-respuesta.ts [cantidad]
import { dependenciasReales } from "@/rag/dependencias";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: falla abajo con un mensaje claro
}

async function main() {
  const limite = Number(process.argv[2] ?? 10);
  const filas = await dependenciasReales().almacen.sinEvidencia(limite);
  for (const f of filas) console.log(`${f.creadoEn ?? ""}  ${f.motivo.padEnd(6)}  sim ${f.mejorSimilitud?.toFixed(3) ?? "—"}  ${f.pregunta}`);
  console.log(`${filas.length} fila(s)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
