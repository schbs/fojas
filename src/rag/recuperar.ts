// Recuperación híbrida: vector (pgvector, coseno) + palabras clave (tsvector), fusionadas con Reciprocal Rank Fusion y
// reordenadas con un reranking simple (similitud coseno + cobertura de los términos de la pregunta).
import type { Almacen, Resultado } from "@/almacen/tipos";
import type { Embeddings } from "@/ia/embeddings";
import { terminos } from "./texto";

export interface ConfigRecuperacion {
  /** Candidatos que trae cada búsqueda. */
  kBusqueda: number;
  /** Chunks que van al prompt como fuentes numeradas. */
  kContexto: number;
  /** Constante de RRF: 1 / (rrfK + posición). 60 es el valor del paper original. */
  rrfK: number;
  /** Cuánto suma, en el reranking, que el chunk contenga los términos de la pregunta (0 a 1). */
  pesoCobertura: number;
}

export const CONFIG_RECUPERACION: ConfigRecuperacion = { kBusqueda: 8, kContexto: 4, rrfK: 60, pesoCobertura: 0.1 };

export interface Candidato extends Resultado {
  posVector: number | null;
  posPalabras: number | null;
  rrf: number;
  cobertura: number;
  puntaje: number;
}

export interface Recuperacion {
  candidatos: Candidato[];
  /** Similitud coseno más alta entre todos los candidatos (la usa el umbral de "no sé"). */
  maxSimilitud: number | null;
  embedding: number[];
}

const clave = (r: Resultado) => `${r.docSlug}|${r.pagina}|${r.contenido.slice(0, 80)}`;

/** Fracción de los términos de la pregunta que aparecen en la sección o el texto del chunk. */
export function cobertura(pregunta: string, r: Pick<Resultado, "seccion" | "contenido">): number {
  const pedidos = [...new Set(terminos(pregunta))];
  if (!pedidos.length) return 0;
  const presentes = new Set(terminos(`${r.seccion} ${r.contenido}`));
  return pedidos.filter((p) => presentes.has(p)).length / pedidos.length;
}

export async function recuperar(
  pregunta: string,
  deps: { almacen: Almacen; embeddings: Embeddings; config?: Partial<ConfigRecuperacion>; doc?: string },
): Promise<Recuperacion> {
  const config = { ...CONFIG_RECUPERACION, ...deps.config };
  const [embedding] = await deps.embeddings.embeber([pregunta], "RETRIEVAL_QUERY");
  const [porVector, porPalabras] = await Promise.all([
    deps.almacen.buscar(embedding, { k: config.kBusqueda, minSimilitud: 0, doc: deps.doc }),
    deps.almacen.buscarPalabras(pregunta, embedding, { k: config.kBusqueda, doc: deps.doc }),
  ]);

  const fusion = new Map<string, Candidato>();
  const sumar = (lista: Resultado[], cual: "posVector" | "posPalabras") =>
    lista.forEach((r, i) => {
      const c = fusion.get(clave(r)) ?? { ...r, posVector: null, posPalabras: null, rrf: 0, cobertura: 0, puntaje: 0 };
      c[cual] = i + 1;
      c.rrf += 1 / (config.rrfK + i + 1);
      fusion.set(clave(r), c);
    });
  sumar(porVector, "posVector");
  sumar(porPalabras, "posPalabras");

  // RRF elige los candidatos; el reranking los ordena con la similitud real y la cobertura de términos.
  const candidatos = [...fusion.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, config.kBusqueda)
    .map((c) => {
      const cob = cobertura(pregunta, c);
      return { ...c, cobertura: cob, puntaje: c.similitud + config.pesoCobertura * cob };
    })
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, config.kContexto);

  const similitudes = [...porVector, ...porPalabras].map((r) => r.similitud);
  return { candidatos, maxSimilitud: similitudes.length ? Math.max(...similitudes) : null, embedding };
}
