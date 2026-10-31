import { terminos } from "@/rag/texto";

// Embeddings: Gemini (gemini-embedding-001, 768 dimensiones, normalizados) o un falso determinista para los tests.
export const DIMENSIONES = 768;
export const MODELO_EMBEDDINGS = "gemini-embedding-001";

export type Tarea = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface Embeddings {
  nombre: string;
  dimensiones: number;
  embeber(textos: string[], tarea: Tarea): Promise<number[][]>;
}

export const normalizar = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

export function coseno(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gemini: un pedido por texto (esta clave no tiene batchEmbedContents), con reintentos ante 429 y 5xx. */
export function crearEmbeddingsGemini(opciones: { apiKey: string; pausaMs?: number; fetch?: typeof fetch }): Embeddings {
  const pedirA = opciones.fetch ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_EMBEDDINGS}:embedContent`;
  return {
    nombre: MODELO_EMBEDDINGS,
    dimensiones: DIMENSIONES,
    async embeber(textos, tarea) {
      const salida: number[][] = [];
      for (const texto of textos) {
        for (let intento = 0; ; intento++) {
          const r = await pedirA(url, {
            method: "POST",
            headers: { "x-goog-api-key": opciones.apiKey, "Content-Type": "application/json" },
            // taskType y outputDimensionality van arriba: dentro de embedContentConfig la API los ignoró (devolvió 3072).
            body: JSON.stringify({ model: `models/${MODELO_EMBEDDINGS}`, content: { parts: [{ text: texto }] }, taskType: tarea, outputDimensionality: DIMENSIONES }),
            signal: AbortSignal.timeout(20_000),
          });
          if ((r.status === 429 || r.status >= 500) && intento < 4) {
            await esperar(1000 * 2 ** intento);
            continue;
          }
          const datos = (await r.json()) as { embedding?: { values?: number[] }; error?: { message?: string } };
          if (!r.ok || !datos.embedding?.values) throw new Error(`Embeddings de Gemini: ${r.status} ${datos.error?.message ?? ""}`.trim());
          // gemini-embedding-001 es Matryoshka: quedarse con las primeras 768 dimensiones es válido (es lo que hace la API
          // con outputDimensionality). Con menos de 3072 no vienen normalizados: se normalizan acá.
          salida.push(normalizar(datos.embedding.values.slice(0, DIMENSIONES)));
          break;
        }
        if (opciones.pausaMs) await esperar(opciones.pausaMs);
      }
      return salida;
    },
  };
}

/**
 * Embeddings falsos y deterministas para los tests: bolsa de palabras con hashing, sin red ni cuota.
 * Dos textos con palabras en común dan coseno alto; así se prueba la búsqueda sin depender de Gemini.
 */
export function crearEmbeddingsFalsos(dimensiones = 512): Embeddings {
  const indice = (palabra: string) => {
    let h = 2166136261;
    for (const c of palabra) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return Math.abs(h) % dimensiones;
  };
  return {
    nombre: "falsos (bolsa de palabras)",
    dimensiones,
    async embeber(textos) {
      return textos.map((t) => {
        const v = new Array<number>(dimensiones).fill(0);
        for (const p of terminos(t)) v[indice(p)] += 1;
        return normalizar(v);
      });
    },
  };
}
