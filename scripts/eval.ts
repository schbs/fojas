// Evaluación de Fojas con las 30 preguntas doradas (data/eval/golden.json): exactitud de cita (documento + página),
// "no sé" correcto, alucinaciones, latencia p50/p95 y costo estimado por pregunta. Guarda el detalle en
// docs/resultados/eval.json.
//
// Uso: npm run eval                     (Supabase: búsqueda híbrida real; usa el caché de embeddings y respuestas)
//      npm run eval -- --sin-cache      (todo en vivo: es la corrida que mide la latencia de verdad)
//      npm run eval -- --memoria        (copia los chunks de Supabase a memoria: sirve antes de aplicar la migración)
//      npm run eval -- --umbral=0.72 --k=4 --cobertura=0.1   (para iterar sin tocar el código)
//      npm run eval -- --idioma=en      (15 preguntas en inglés de data/eval/golden-en.json → docs/resultados/eval-en.json)
//
// El caché (data/eval/cache/, fuera del repo) guarda los embeddings de cada pregunta y la respuesta de Gemini para cada
// pedido exacto: si cambia el prompt o el contexto, el pedido es otro y se vuelve a llamar al modelo.
import fs from "node:fs";
import path from "node:path";
import { crearAlmacenMemoria } from "../src/almacen/memoria";
import { crearAlmacenSupabase } from "../src/almacen/supabase";
import type { Almacen } from "../src/almacen/tipos";
import { crearEmbeddingsGemini, type Embeddings } from "../src/ia/embeddings";
import { crearModeloConCache, crearModeloGemini, type RespuestaJson } from "../src/ia/gemini";
import { CONFIG_RECUPERACION, recuperar } from "../src/rag/recuperar";
import { CONFIG_RESPUESTA, PROMPT_VERSION, responder, type ConfigRespuesta } from "../src/rag/responder";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: falla abajo con un mensaje claro
}

// Precios del plan pago de Gemini (ai.google.dev/gemini-api/docs/pricing, consultado el 31/10/2026), en USD por millón
// de tokens. En el plan gratis el costo es 0; esto estima cuánto costaría cada pregunta pagando.
const PRECIO = { entrada: 0.3, salida: 2.5, embeddings: 0.15 };

interface Dorada {
  id: string;
  pregunta: string;
  esperado: { doc: string; pagina: number }[];
}

const argumento = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
const sinCache = process.argv.includes("--sin-cache");
const enMemoria = process.argv.includes("--memoria");
const idioma = argumento("idioma") === "en" ? "en" : "es";
const SUFIJO = idioma === "en" ? "-en" : "";
const DIR_CACHE = path.join("data", "eval", "cache");
const leerJson = <T>(archivo: string, vacio: T): T => (fs.existsSync(archivo) ? (JSON.parse(fs.readFileSync(archivo, "utf8")) as T) : vacio);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const percentil = (xs: number[], p: number) => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};

/** Embeddings con caché en disco por texto: repetir la evaluación no gasta cuota de embeddings. */
function embeddingsConCache(real: Embeddings, cache: Record<string, number[]>): Embeddings & { nuevos: number } {
  const env = {
    ...real,
    nuevos: 0,
    async embeber(textos: string[], tarea: Parameters<Embeddings["embeber"]>[1]) {
      const faltan = textos.filter((t) => !cache[`${tarea}:${t}`]);
      if (faltan.length) {
        const nuevos = await real.embeber(faltan, tarea);
        faltan.forEach((t, i) => (cache[`${tarea}:${t}`] = nuevos[i]));
        env.nuevos += faltan.length;
      }
      return textos.map((t) => cache[`${tarea}:${t}`]);
    },
  };
  return env;
}

/** Copia documentos y chunks (con sus embeddings) de Supabase a memoria, sin pedir embeddings nuevos. */
async function copiarAMemoria(url: string, clave: string): Promise<Almacen> {
  const pedir = async <T>(ruta: string) => {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1${ruta}`, { headers: { apikey: clave, Authorization: `Bearer ${clave}` }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`Supabase GET ${ruta.split("?")[0]} → ${r.status}`);
    return (await r.json()) as T;
  };
  const almacen = crearAlmacenMemoria();
  for (const d of await pedir<{ slug: string; titulo: string; hash_archivo: string; paginas: number }[]>("/documents?select=*")) {
    await almacen.guardarDocumento({ slug: d.slug, titulo: d.titulo, hashArchivo: d.hash_archivo, paginas: d.paginas });
  }
  const chunks = await pedir<{ doc_slug: string; page: number; section: string; contenido: string; hash: string; embedding: string }[]>("/chunks?select=doc_slug,page,section,contenido,hash,embedding");
  await almacen.agregarChunks(chunks.map((c) => ({ docSlug: c.doc_slug, pagina: c.page, seccion: c.section, contenido: c.contenido, hash: c.hash, embedding: JSON.parse(c.embedding) as number[] })));
  return almacen;
}

async function main() {
  const faltan = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((n) => !process.env[n]);
  if (faltan.length) throw new Error(`Faltan variables: ${faltan.join(", ")} (npm run check-env).`);
  const env = process.env as Record<string, string>;

  const config: Partial<ConfigRespuesta> = {};
  if (argumento("umbral")) config.umbral = Number(argumento("umbral"));
  if (argumento("k")) config.kContexto = Number(argumento("k"));
  if (argumento("cobertura")) config.pesoCobertura = Number(argumento("cobertura"));

  const almacen = enMemoria ? await copiarAMemoria(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY) : crearAlmacenSupabase({ url: env.SUPABASE_URL, clave: env.SUPABASE_SECRET_KEY });
  fs.mkdirSync(DIR_CACHE, { recursive: true });
  const archivoEmb = path.join(DIR_CACHE, "embeddings.json");
  const archivoResp = path.join(DIR_CACHE, "respuestas.json");
  const cacheEmb = sinCache ? {} : leerJson<Record<string, number[]>>(archivoEmb, {});
  const cacheResp = sinCache ? {} : leerJson<Record<string, RespuestaJson>>(archivoResp, {});
  const embeddings = embeddingsConCache(crearEmbeddingsGemini({ apiKey: env.GEMINI_API_KEY }), cacheEmb);
  const modelo = crearModeloConCache(cacheResp, crearModeloGemini({ apiKey: env.GEMINI_API_KEY, modelo: env.GEMINI_MODEL || undefined }));

  const golden = (JSON.parse(fs.readFileSync(path.join("data", "eval", `golden${SUFIJO}.json`), "utf8")) as { preguntas: Dorada[] }).preguntas;

  // --solo-recuperacion: sin llamar al modelo, mide si la página esperada llega a las fuentes y la similitud máxima de
  // cada pregunta (sirve para elegir el umbral y el k).
  if (process.argv.includes("--solo-recuperacion")) {
    const conf = { ...CONFIG_RECUPERACION, ...config };
    const umbral = config.umbral ?? CONFIG_RESPUESTA.umbral;
    let enContexto = 0;
    const sims: { id: string; sim: number; respondible: boolean }[] = [];
    for (const q of golden) {
      const r = await recuperar(q.pregunta, { almacen, embeddings, config: conf });
      const pos = r.candidatos.findIndex((c) => q.esperado.some((e) => e.doc === c.docSlug && e.pagina === c.pagina));
      if (q.esperado.length && pos >= 0) enContexto++;
      sims.push({ id: q.id, sim: r.maxSimilitud ?? 0, respondible: q.esperado.length > 0 });
      console.log(`${q.id} sim ${(r.maxSimilitud ?? 0).toFixed(3)} ${q.esperado.length ? (pos >= 0 ? `página esperada en la fuente ${pos + 1}` : "página esperada AUSENTE") : "(no respondible)"} · ${r.candidatos.map((c) => `${c.docSlug.slice(0, 2)}p${c.pagina}`).join(" ")}`);
    }
    fs.writeFileSync(archivoEmb, JSON.stringify(cacheEmb));
    const min = (xs: number[]) => Math.min(...xs).toFixed(3);
    const max = (xs: number[]) => Math.max(...xs).toFixed(3);
    const deR = sims.filter((s) => s.respondible).map((s) => s.sim);
    const deN = sims.filter((s) => !s.respondible).map((s) => s.sim);
    console.log(`\nPágina esperada entre las ${conf.kContexto} fuentes: ${enContexto}/${deR.length}`);
    console.log(`Similitud máxima: respondibles ${min(deR)}–${max(deR)} · no respondibles ${min(deN)}–${max(deN)}`);
    console.log(`Con umbral ${umbral}: ${deR.filter((s) => s < umbral).length} respondibles se cortarían; ${deN.filter((s) => s < umbral).length}/${deN.length} no respondibles se cortarían sin llamar al modelo`);
    console.log(`Embeddings nuevos: ${embeddings.nuevos}`);
    return;
  }

  const filas = [];
  for (const q of golden) {
    const antes = modelo.nuevas;
    const { respuesta, traza } = await responder(q.pregunta, { almacen, embeddings, modelo, config, registrar: false, idioma });
    const respondible = q.esperado.length > 0;
    const citaCorrecta = !respuesta.sin_evidencia && respuesta.citas.some((c) => q.esperado.some((e) => e.doc === c.doc && e.pagina === c.pagina));
    const costo = ((traza.uso.entrada * PRECIO.entrada + traza.uso.salida * PRECIO.salida) / 1e6) + (Math.ceil(q.pregunta.length / 4) * PRECIO.embeddings) / 1e6;
    filas.push({ id: q.id, pregunta: q.pregunta, respondible, ...respuesta, citaCorrecta, traza, costo });
    const marca = respondible ? (citaCorrecta ? "✓" : respuesta.sin_evidencia ? "?" : "✗") : respuesta.sin_evidencia ? "✓" : "✗";
    console.log(`${marca} ${q.id} sim ${traza.maxSimilitud?.toFixed(3) ?? "—"} ${respuesta.sin_evidencia ? `no sé (${traza.motivo})` : respuesta.citas.map((c) => `${c.doc} p${c.pagina}`).join(", ")}${traza.citasDescartadas ? ` · ${traza.citasDescartadas} cita(s) descartada(s)` : ""}${traza.error ? ` · error: ${traza.error}` : ""}`);
    // Pausa solo si hubo una llamada nueva al modelo (cuota por minuto del plan gratis).
    if (modelo.nuevas > antes) await esperar(4000);
  }
  if (!sinCache) {
    fs.writeFileSync(archivoEmb, JSON.stringify(cacheEmb));
    fs.writeFileSync(archivoResp, JSON.stringify(cacheResp));
  }

  const respondibles = filas.filter((f) => f.respondible);
  const noRespondibles = filas.filter((f) => !f.respondible);
  const pct = (n: number, d: number) => `${n}/${d} = ${((100 * n) / d).toFixed(1).replace(".0", "")} %`;
  const exactitud = respondibles.filter((f) => f.citaCorrecta).length;
  const noSeCorrecto = noRespondibles.filter((f) => f.sin_evidencia).length;
  const sinCitaValida = filas.filter((f) => !f.sin_evidencia && f.citas.length === 0).length;
  const respondioTrampa = noRespondibles.filter((f) => !f.sin_evidencia).length;
  const noSeDeMas = respondibles.filter((f) => f.sin_evidencia).length;
  const descartadas = filas.reduce((s, f) => s + f.traza.citasDescartadas, 0);
  const latencias = filas.map((f) => f.traza.ms);
  const costoMedio = filas.reduce((s, f) => s + f.costo, 0) / filas.length;
  const conCache = !sinCache && (modelo.nuevas < filas.filter((f) => f.traza.llamoAlModelo).length || embeddings.nuevos < filas.length);

  const tabla: [string, string, string][] = [
    [`Exactitud de cita (documento + página), ${respondibles.length} respondibles`, pct(exactitud, respondibles.length), "≥ 85 %"],
    [`"No sé" correcto, ${noRespondibles.length} no respondibles`, pct(noSeCorrecto, noRespondibles.length), "≥ 90 %"],
    ["Alucinaciones (respuesta sin cita válida)", String(sinCitaValida), "0"],
    ["No respondibles que se respondieron igual", String(respondioTrampa), "—"],
    ['Respondibles con "no sé"', String(noSeDeMas), "—"],
    ["Citas del modelo descartadas por el validador", String(descartadas), "—"],
    ["Latencia p50 / p95", conCache ? "no medida (con caché)" : `${(percentil(latencias, 50) / 1000).toFixed(1)} s / ${(percentil(latencias, 95) / 1000).toFixed(1)} s`, "—"],
    ["Costo estimado por pregunta (plan pago)", `USD ${costoMedio.toFixed(5)}`, "—"],
  ];
  console.log(`\nAlmacén: ${almacen.nombre}${enMemoria ? " (copia de Supabase)" : ""} · modelo: ${sinCache ? modelo.nombre.replace(" (con caché)", " (en vivo)") : modelo.nombre} · prompt ${PROMPT_VERSION} · idioma ${idioma} · ${JSON.stringify(config)}`);
  console.log(`Llamadas nuevas: ${modelo.nuevas} al modelo, ${embeddings.nuevos} embeddings\n`);
  console.log("| Métrica | Resultado | Meta |\n|---|---|---|");
  for (const [m, r, meta] of tabla) console.log(`| ${m} | ${r} | ${meta} |`);
  const cumple = exactitud / respondibles.length >= 0.85 && noSeCorrecto / noRespondibles.length >= 0.9 && sinCitaValida === 0;
  console.log(`\n${cumple ? "✓ Cumple las metas de P2-G2" : "✗ Todavía no cumple las metas"}`);

  const salida = path.join("docs", "resultados", `eval${SUFIJO}.json`);
  // Una corrida con caché no mide la latencia: no pisa un resultado guardado que sí la tiene.
  if (conCache && fs.existsSync(salida)) {
    console.log(`(corrida con caché: no se reescribe ${salida})`);
    return;
  }
  fs.mkdirSync(path.join("docs", "resultados"), { recursive: true });
  fs.writeFileSync(
    salida,
    JSON.stringify({ fecha: new Date().toISOString(), almacen: almacen.nombre, modelo: modelo.nombre, prompt: PROMPT_VERSION, idioma, config, conCache, tabla, filas }, null, 2),
  );
  console.log(`→ ${salida}`);
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
