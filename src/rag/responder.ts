// Respuesta con citas: recuperación híbrida → umbral de similitud → Gemini con fuentes numeradas y salida JSON →
// validación de cada cita contra el texto de su fuente. Si no hay evidencia, responde siempre lo mismo y lo registra.
import { z } from "zod";
import type { Almacen, MotivoSinEvidencia } from "@/almacen/tipos";
import type { Embeddings } from "@/ia/embeddings";
import type { ModeloJson, Uso } from "@/ia/gemini";
import { recuperar, type Candidato, type ConfigRecuperacion } from "./recuperar";
import { paraComparar } from "./texto";

export type Idioma = "es" | "en";

export const MENSAJES_SIN_EVIDENCIA: Record<Idioma, string> = {
  es: "No encuentro eso en los documentos del estudio; lo derivo a un contador.",
  en: "I can't find that in the firm's documents; I'm passing your question to an accountant.",
};
export const MENSAJE_SIN_EVIDENCIA = MENSAJES_SIN_EVIDENCIA.es;

/** Lo que devuelve /api/ask. Siempre se valida con este schema antes de salir. */
export const respuestaSchema = z
  .object({
    respuesta: z.string().min(1),
    citas: z.array(z.object({ doc: z.string().min(1), titulo: z.string().min(1), pagina: z.number().int().positive(), fragmento: z.string().min(1) })),
    confianza: z.enum(["alta", "media", "baja"]),
    sin_evidencia: z.boolean(),
  })
  .refine((r) => (r.sin_evidencia ? r.citas.length === 0 && Object.values(MENSAJES_SIN_EVIDENCIA).includes(r.respuesta) : r.citas.length > 0), {
    message: "Una respuesta sin evidencia no lleva citas; una con evidencia lleva al menos una",
  });

export type Respuesta = z.infer<typeof respuestaSchema>;

/** Lo que se le pide al modelo: la fuente va por número y la cita, copiada textual. */
export const salidaModeloSchema = z.object({
  sin_evidencia: z.boolean(),
  respuesta: z.string(),
  citas: z.array(z.object({ fuente: z.number().int().min(1).max(10), fragmento: z.string() })),
  confianza: z.enum(["alta", "media", "baja"]),
});

export const PROMPT_VERSION = "v1";

export const SISTEMA = `Sos el asistente del Estudio Ruca & Asociados, un estudio contable (ficticio). Respondés consultas de clientes usando SOLO las fuentes numeradas que vienen con la pregunta: circulares y guías internas del estudio.

Reglas:
1. Si las fuentes no contienen la respuesta, devolvé sin_evidencia=true, respuesta vacía y citas vacías. Lo mismo si la pregunta pide un dato que las fuentes no dan (un monto, una fecha, una norma, un trámite), aunque el tema se mencione.
2. Nunca uses conocimiento propio: nada de normativa, montos, plazos ni recomendaciones que no estén escritos en las fuentes.
3. Cada respuesta lleva al menos una cita: "fuente" es el número de la fuente y "fragmento" es una o dos oraciones copiadas TEXTUALES de esa fuente (mismas palabras, sin resumir ni cambiar nada).
4. Respuesta breve, en español rioplatense, de 1 a 3 oraciones, dirigida al cliente.
5. confianza: "alta" si una fuente lo dice directamente; "media" si hay que combinar fuentes; "baja" si las fuentes lo cubren solo en parte.`;

export interface ConfigRespuesta extends ConfigRecuperacion {
  /** Similitud coseno mínima del mejor chunk para llamar al modelo. Por debajo: "no sé" sin gastar cuota. */
  umbral: number;
  /**
   * Umbral para preguntas en inglés: los documentos están en español y la similitud entre idiomas es más baja
   * (medido: respondibles 0,679–0,768, trampas 0,506–0,682; con 0,70 se cortaban 2 respondibles).
   */
  umbralEn: number;
  /** Largo mínimo de una cita (caracteres) para aceptarla como evidencia. */
  minCita: number;
}

export const CONFIG_RESPUESTA: Omit<ConfigRespuesta, keyof ConfigRecuperacion> = { umbral: 0.7, umbralEn: 0.65, minCita: 15 };

export interface Traza {
  maxSimilitud: number | null;
  contexto: { doc: string; pagina: number; seccion: string; similitud: number; puntaje: number }[];
  motivo: MotivoSinEvidencia | null;
  /** Citas que devolvió el modelo pero no aparecen textuales en su fuente (o señalan una fuente que no existe). */
  citasDescartadas: number;
  uso: Uso;
  llamoAlModelo: boolean;
  error?: string;
  ms: number;
}

export function armarUsuario(pregunta: string, fuentes: Candidato[], idioma: Idioma = "es"): string {
  const bloques = fuentes.map((f, i) => `[${i + 1}] ${f.titulo} — página ${f.pagina} — ${f.seccion}\n${f.contenido}`);
  // En inglés solo cambia el idioma de "respuesta": las citas siguen textuales, en el idioma de la fuente. En español el
  // pedido queda idéntico al de la evaluación (mismo caché).
  const instruccion = idioma === "en" ? "\n\nIdioma de la respuesta: inglés. Los fragmentos de las citas van igual TEXTUALES, en español, como están en la fuente." : "";
  return `Pregunta del cliente: ${pregunta}${instruccion}\n\nFuentes:\n\n${bloques.join("\n\n")}`;
}

/** Una cita vale si su texto aparece en la fuente que señala (ignorando mayúsculas, tildes, comillas y espacios). */
export function citaValida(fragmento: string, fuente: Pick<Candidato, "seccion" | "contenido">, minCita: number): boolean {
  const texto = paraComparar(`${fuente.seccion} ${fuente.contenido}`);
  // Si el modelo cortó la cita con "…", cada parte tiene que estar en la fuente.
  const partes = fragmento
    .split(/\.\.\.|…/)
    .map((p) => paraComparar(p).replace(/^["'\s.,;:]+|["'\s.,;:]+$/g, ""))
    .filter(Boolean);
  if (!partes.length || partes.join(" ").length < minCita) return false;
  return partes.every((p) => texto.includes(p));
}

const sinEvidencia = (idioma: Idioma = "es"): Respuesta => ({ respuesta: MENSAJES_SIN_EVIDENCIA[idioma], citas: [], confianza: "baja", sin_evidencia: true });

/** Avance de una respuesta, para mostrarlo mientras se arma (el texto sale recién con las citas ya validadas). */
export type Etapa = { tipo: "fuentes"; fuentes: { doc: string; titulo: string; pagina: number; seccion: string }[] } | { tipo: "redactando" };

export async function responder(
  pregunta: string,
  deps: {
    almacen: Almacen;
    embeddings: Embeddings;
    modelo: ModeloJson;
    config?: Partial<ConfigRespuesta>;
    registrar?: boolean;
    /** Idioma de la respuesta (las citas quedan en el idioma del documento). */
    idioma?: Idioma;
    alAvanzar?: (etapa: Etapa) => void;
  },
): Promise<{ respuesta: Respuesta; traza: Traza }> {
  const t0 = Date.now();
  const config = { ...CONFIG_RESPUESTA, ...deps.config };
  const rec = await recuperar(pregunta, { almacen: deps.almacen, embeddings: deps.embeddings, config: deps.config });
  const traza: Traza = {
    maxSimilitud: rec.maxSimilitud,
    contexto: rec.candidatos.map((c) => ({ doc: c.docSlug, pagina: c.pagina, seccion: c.seccion, similitud: c.similitud, puntaje: c.puntaje })),
    motivo: null,
    citasDescartadas: 0,
    uso: { entrada: 0, salida: 0 },
    llamoAlModelo: false,
    ms: 0,
  };

  const terminar = async (respuesta: Respuesta, motivo: MotivoSinEvidencia | null) => {
    traza.motivo = motivo;
    traza.ms = Date.now() - t0;
    if (motivo && deps.registrar !== false) {
      // Si el registro falla, la respuesta igual sale: perder una fila es menos grave que dejar al cliente sin respuesta.
      await deps.almacen.registrarSinEvidencia({ pregunta, mejorSimilitud: rec.maxSimilitud, motivo }).catch(() => undefined);
    }
    return { respuesta: respuestaSchema.parse(respuesta), traza };
  };

  const umbral = deps.idioma === "en" ? config.umbralEn : config.umbral;
  if (rec.maxSimilitud === null || rec.maxSimilitud < umbral || !rec.candidatos.length) return terminar(sinEvidencia(deps.idioma), "umbral");

  deps.alAvanzar?.({ tipo: "fuentes", fuentes: rec.candidatos.map((c) => ({ doc: c.docSlug, titulo: c.titulo, pagina: c.pagina, seccion: c.seccion })) });
  deps.alAvanzar?.({ tipo: "redactando" });

  let salida: z.infer<typeof salidaModeloSchema>;
  try {
    traza.llamoAlModelo = true;
    const r = await deps.modelo.generar({ sistema: SISTEMA, usuario: armarUsuario(pregunta, rec.candidatos, deps.idioma), schema: z.toJSONSchema(salidaModeloSchema) as Record<string, unknown> });
    traza.uso = r.uso;
    salida = salidaModeloSchema.parse(r.json);
  } catch (e) {
    // Sin respuesta válida del modelo no se inventa nada: se deriva.
    traza.error = e instanceof Error ? e.message : String(e);
    return terminar(sinEvidencia(deps.idioma), "modelo");
  }
  if (salida.sin_evidencia || !salida.respuesta.trim()) return terminar(sinEvidencia(deps.idioma), "modelo");

  const citas: Respuesta["citas"] = [];
  for (const c of salida.citas) {
    const fuente = rec.candidatos[c.fuente - 1];
    if (!fuente || !citaValida(c.fragmento, fuente, config.minCita)) {
      traza.citasDescartadas++;
      continue;
    }
    if (!citas.some((x) => x.doc === fuente.docSlug && x.pagina === fuente.pagina && x.fragmento === c.fragmento)) {
      citas.push({ doc: fuente.docSlug, titulo: fuente.titulo, pagina: fuente.pagina, fragmento: c.fragmento.trim() });
    }
  }
  // Una respuesta que ninguna cita sostiene no sale: se deriva.
  if (!citas.length) return terminar(sinEvidencia(deps.idioma), "citas");
  return terminar({ respuesta: salida.respuesta.trim(), citas, confianza: salida.confianza, sin_evidencia: false }, null);
}
