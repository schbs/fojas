import { beforeAll, describe, expect, it } from "vitest";
import { crearManejadorAsk, ipCliente } from "@/api/ask";
import { crearAlmacenMemoria } from "@/almacen/memoria";
import type { Almacen } from "@/almacen/tipos";
import { crearEmbeddingsFalsos } from "@/ia/embeddings";
import { CupoAgotado, crearModeloConCache, crearModeloGemini, type ModeloJson } from "@/ia/gemini";
import { cargarCorpus } from "@/ingesta/corpus";
import { ingestar } from "@/ingesta/ingestar";
import { recuperar } from "@/rag/recuperar";
import { citaValida, MENSAJE_SIN_EVIDENCIA, respuestaSchema, responder } from "@/rag/responder";

const embeddings = crearEmbeddingsFalsos();
// Con embeddings falsos (bolsa de palabras) las similitudes son más bajas que con Gemini: el umbral de prueba baja.
const config = { umbral: 0.2 };
let almacen: Almacen;

beforeAll(async () => {
  almacen = crearAlmacenMemoria();
  await ingestar(cargarCorpus(), almacen, embeddings);
});

/** Modelo falso: responde con la primera oración de la fuente pedida (o inventa una cita, o dice que no sabe). */
function modeloFalso(modo: "copia" | "inventa" | "no_sabe" | "falla", fuente = 1): ModeloJson & { llamadas: number } {
  const m = {
    nombre: "falso",
    llamadas: 0,
    async generar({ usuario }: { usuario: string }) {
      m.llamadas++;
      if (modo === "falla") throw new Error("Gemini respondió 503");
      if (modo === "no_sabe") return { json: { sin_evidencia: true, respuesta: "", citas: [], confianza: "baja" }, uso: { entrada: 100, salida: 10 } };
      const bloque = usuario.split(/\n\n(?=\[\d+\] )/).find((b) => b.startsWith(`[${fuente}] `)) ?? "";
      const texto = bloque.split("\n").slice(1).join(" ");
      const oracion = texto.split(/(?<=\.)\s/)[1] ?? texto;
      const fragmento = modo === "copia" ? oracion : "El estudio devuelve el dinero de los turnos cancelados en 48 horas.";
      return { json: { sin_evidencia: false, respuesta: "Respuesta de prueba.", citas: [{ fuente, fragmento }], confianza: "alta" }, uso: { entrada: 900, salida: 60 } };
    },
  };
  return m;
}

describe("búsqueda por palabras y recuperación híbrida", () => {
  it("la búsqueda por palabras encuentra la sección por su título (sección con más peso)", async () => {
    const [q] = await embeddings.embeber(["cancelaciones de turnos"], "RETRIEVAL_QUERY");
    const r = await almacen.buscarPalabras("cancelaciones de turnos", q, { k: 3 });
    expect(r[0]).toMatchObject({ docSlug: "04-politica-turnos", pagina: 2, seccion: "Cancelaciones" });
    expect(r[0].rango).toBeGreaterThan(0);
  });

  it("una pregunta sin palabras con contenido no trae nada por palabras", async () => {
    expect(await almacen.buscarPalabras("¿y eso?", [], { k: 3 })).toEqual([]);
  });

  it("fusiona vector y palabras (RRF), reordena y deja k fuentes con la similitud máxima", async () => {
    const r = await recuperar("¿Hasta cuándo puedo cancelar un turno sin costo?", { almacen, embeddings, config: { kContexto: 3 } });
    expect(r.candidatos).toHaveLength(3);
    expect(r.candidatos[0]).toMatchObject({ docSlug: "04-politica-turnos", pagina: 2 });
    expect(r.candidatos[0].posVector ?? r.candidatos[0].posPalabras).not.toBeNull();
    expect(r.maxSimilitud).toBeGreaterThanOrEqual(r.candidatos[0].similitud);
    // El reranking deja el puntaje ordenado de mayor a menor.
    expect(r.candidatos.map((c) => c.puntaje)).toEqual([...r.candidatos.map((c) => c.puntaje)].sort((a, b) => b - a));
  });
});

describe("validación de citas", () => {
  const fuente = { seccion: "Cancelaciones", contenido: "Un turno se puede cancelar o cambiar sin costo hasta 24 horas antes. Si el cliente no se presenta, el turno cuenta como consulta." };
  it("acepta una cita textual aunque cambien mayúsculas, tildes, comillas o espacios", () => {
    expect(citaValida("un turno se puede  cancelar o cambiar sin costo hasta 24 horas antes.", fuente, 15)).toBe(true);
    expect(citaValida("“Un turno se puede cancelar o cambiar sin costo hasta 24 horas antes”", fuente, 15)).toBe(true);
  });
  it("acepta una cita cortada con … si cada parte está en la fuente", () => {
    expect(citaValida("Un turno se puede cancelar… hasta 24 horas antes", fuente, 15)).toBe(true);
  });
  it("rechaza una cita reescrita, inventada o demasiado corta", () => {
    expect(citaValida("Un turno se puede cancelar sin costo hasta 48 horas antes.", fuente, 15)).toBe(false);
    expect(citaValida("Los turnos cancelados se reintegran.", fuente, 15)).toBe(false);
    expect(citaValida("24 horas", fuente, 15)).toBe(false);
  });
});

describe("responder", () => {
  it("con evidencia: JSON validado, citas con documento y página de la fuente, y no registra nada", async () => {
    const memoria = crearAlmacenMemoria();
    await ingestar(cargarCorpus(), memoria, embeddings);
    const { respuesta, traza } = await responder("¿Hasta cuándo puedo cancelar un turno sin costo?", { almacen: memoria, embeddings, modelo: modeloFalso("copia"), config });
    expect(respuesta.sin_evidencia).toBe(false);
    expect(respuesta.citas[0]).toMatchObject({ doc: traza.contexto[0].doc, pagina: traza.contexto[0].pagina });
    expect(respuestaSchema.safeParse(respuesta).success).toBe(true);
    expect(await memoria.sinEvidencia(10)).toEqual([]);
  });

  it("por debajo del umbral: \"no sé\" sin llamar al modelo, y queda registrada con motivo umbral", async () => {
    const memoria = crearAlmacenMemoria();
    await ingestar(cargarCorpus(), memoria, embeddings);
    const modelo = modeloFalso("copia");
    const { respuesta, traza } = await responder("¿Quién ganó el último mundial de fútbol?", { almacen: memoria, embeddings, modelo, config: { umbral: 0.95 } });
    expect(respuesta).toEqual({ respuesta: MENSAJE_SIN_EVIDENCIA, citas: [], confianza: "baja", sin_evidencia: true });
    expect(modelo.llamadas).toBe(0);
    expect(traza.motivo).toBe("umbral");
    expect(await memoria.sinEvidencia(10)).toMatchObject([{ pregunta: "¿Quién ganó el último mundial de fútbol?", motivo: "umbral" }]);
  });

  it("si el modelo dice que no está en las fuentes: \"no sé\" con motivo modelo", async () => {
    const { respuesta, traza } = await responder("¿Cuál es la alícuota general de IVA?", { almacen, embeddings, modelo: modeloFalso("no_sabe"), config, registrar: false });
    expect(respuesta.sin_evidencia).toBe(true);
    expect(traza.motivo).toBe("modelo");
  });

  it("si la cita no está en la fuente (o señala una fuente que no existe), la respuesta no sale: motivo citas", async () => {
    const inventa = await responder("¿Hasta cuándo puedo cancelar un turno?", { almacen, embeddings, modelo: modeloFalso("inventa"), config, registrar: false });
    expect(inventa.respuesta.sin_evidencia).toBe(true);
    expect(inventa.traza).toMatchObject({ motivo: "citas", citasDescartadas: 1 });
    const fuera = await responder("¿Hasta cuándo puedo cancelar un turno?", { almacen, embeddings, modelo: modeloFalso("copia", 9), config, registrar: false });
    expect(fuera.traza).toMatchObject({ motivo: "citas", citasDescartadas: 1 });
  });

  it("si el modelo falla, deriva (no inventa) y guarda el error en la traza", async () => {
    const { respuesta, traza } = await responder("¿Hasta cuándo puedo cancelar un turno?", { almacen, embeddings, modelo: modeloFalso("falla"), config, registrar: false });
    expect(respuesta.sin_evidencia).toBe(true);
    expect(traza).toMatchObject({ motivo: "modelo", error: "Gemini respondió 503" });
  });

  it("el schema rechaza un \"no sé\" con citas y una respuesta sin citas", () => {
    expect(respuestaSchema.safeParse({ respuesta: MENSAJE_SIN_EVIDENCIA, citas: [{ doc: "a", titulo: "A", pagina: 1, fragmento: "x" }], confianza: "baja", sin_evidencia: true }).success).toBe(false);
    expect(respuestaSchema.safeParse({ respuesta: "Sí.", citas: [], confianza: "alta", sin_evidencia: false }).success).toBe(false);
  });
});

describe("/api/ask", () => {
  const pedir = (manejar: (r: Request) => Promise<Response>, cuerpo: unknown, ip = "1.2.3.4") =>
    manejar(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify(cuerpo), headers: { "x-forwarded-for": ip } }));

  it("pregunta válida → 200 con el JSON del schema; vacía → 400; más de 10 por minuto → 429", async () => {
    const manejar = crearManejadorAsk({ dependencias: () => ({ almacen, embeddings, modelo: modeloFalso("copia") }) });
    const ok = await pedir(manejar, { pregunta: "¿Hasta cuándo puedo cancelar un turno sin costo?" });
    expect(ok.status).toBe(200);
    expect(respuestaSchema.safeParse(await ok.json()).success).toBe(true);
    expect((await pedir(manejar, { pregunta: " " })).status).toBe(400);
    const otro = crearManejadorAsk({ dependencias: () => ({ almacen, embeddings, modelo: modeloFalso("no_sabe") }), limitePorMinuto: 2 });
    await pedir(otro, { pregunta: "hola hola" }, "9.9.9.9");
    await pedir(otro, { pregunta: "hola hola" }, "9.9.9.9");
    expect((await pedir(otro, { pregunta: "hola hola" }, "9.9.9.9")).status).toBe(429);
  });

  it("la IP sale de x-real-ip o de la última entrada de x-forwarded-for (la primera la puede inventar el cliente)", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(ipCliente(req({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1, 5.5.5.5" }))).toBe("5.5.5.5");
    expect(ipCliente(req({ "x-forwarded-for": "1.1.1.1, 7.7.7.7" }))).toBe("7.7.7.7");
    expect(ipCliente(req({}))).toBe("local");
  });

  it("el tope global corta aunque cada pedido venga de otra IP", async () => {
    const manejar = crearManejadorAsk({ dependencias: () => ({ almacen, embeddings, modelo: modeloFalso("no_sabe") }), limiteGlobalPorMinuto: 2 });
    // Los pedidos inválidos no gastan el tope global.
    for (let i = 0; i < 5; i++) expect((await pedir(manejar, { pregunta: "" }, `2.0.0.${i}`)).status).toBe(400);
    await pedir(manejar, { pregunta: "hola hola" }, "1.0.0.1");
    await pedir(manejar, { pregunta: "hola hola" }, "1.0.0.2");
    expect((await pedir(manejar, { pregunta: "hola hola" }, "1.0.0.3")).status).toBe(429);
  });

  it("si falta la base o los embeddings → 503 sin detalles internos", async () => {
    const manejar = crearManejadorAsk({ dependencias: () => { throw new Error("Faltan variables: SUPABASE_URL"); } });
    const r = await pedir(manejar, { pregunta: "¿Atienden los sábados?" });
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("SUPABASE");
  });
});

describe("cliente de Gemini", () => {
  it("un 429 que pide esperar horas es el cupo diario: no reintenta", async () => {
    let llamadas = 0;
    const falso = (async () => {
      llamadas++;
      return new Response(JSON.stringify({ error: { message: "Quota exceeded. Please retry in 2h3m4.5s." } }), { status: 429 });
    }) as typeof fetch;
    await expect(crearModeloGemini({ apiKey: "k", fetch: falso }).generar({ sistema: "s", usuario: "u", schema: {} })).rejects.toBeInstanceOf(CupoAgotado);
    expect(llamadas).toBe(1);
  });

  it("el caché repite un pedido igual sin llamar al modelo y llama si el pedido cambia", async () => {
    const real = modeloFalso("no_sabe");
    const cache = crearModeloConCache({}, real);
    await cache.generar({ sistema: "s", usuario: "u", schema: {} });
    await cache.generar({ sistema: "s", usuario: "u", schema: {} });
    await cache.generar({ sistema: "s", usuario: "otra", schema: {} });
    expect(real.llamadas).toBe(2);
    expect(cache.nuevas).toBe(2);
  });
});
