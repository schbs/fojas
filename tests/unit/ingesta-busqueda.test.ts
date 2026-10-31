import { describe, expect, it } from "vitest";
import { crearAlmacenMemoria } from "@/almacen/memoria";
import { coseno, crearEmbeddingsFalsos, normalizar } from "@/ia/embeddings";
import { cargarCorpus } from "@/ingesta/corpus";
import { ingestar } from "@/ingesta/ingestar";

const corpus = cargarCorpus();
const embeddings = crearEmbeddingsFalsos();

describe("ingesta", () => {
  it("12 documentos, N chunks, 0 duplicados", async () => {
    const almacen = crearAlmacenMemoria();
    const r = await ingestar(corpus, almacen, embeddings);
    const conteo = await almacen.contar();
    console.log(`  ${conteo.documentos} documentos, ${conteo.chunks} chunks, ${conteo.hashesRepetidos} duplicados`);
    expect(conteo.documentos).toBe(12);
    expect(conteo.chunks).toBe(r.chunksNuevos);
    expect(conteo.hashesRepetidos).toBe(0);
  });

  it("la reingesta del mismo corpus no agrega ni pide nada", async () => {
    const almacen = crearAlmacenMemoria();
    await ingestar(corpus, almacen, embeddings);
    const antes = await almacen.contar();
    const r = await ingestar(corpus, almacen, embeddings);
    expect(r).toMatchObject({ sinCambios: 12, chunksNuevos: 0, chunksBorrados: 0, embeddingsPedidos: 0 });
    expect(await almacen.contar()).toEqual(antes);
  });

  it("si la ingesta se corta a la mitad, la próxima corrida retoma el documento (no queda marcado como hecho)", async () => {
    const almacen = crearAlmacenMemoria();
    const roto = { ...embeddings, embeber: async () => { throw new Error("cupo agotado"); } };
    await expect(ingestar([corpus[0]], almacen, roto)).rejects.toThrow("cupo agotado");
    const r = await ingestar([corpus[0]], almacen, embeddings);
    expect(r.sinCambios).toBe(0);
    expect(r.chunksNuevos).toBeGreaterThan(0);
  });

  it("Gemini: aunque devuelva 3072 dimensiones, se guardan 768 normalizadas", async () => {
    const { crearEmbeddingsGemini, DIMENSIONES } = await import("@/ia/embeddings");
    const cuerpos: string[] = [];
    const falso = (async (_u: string, init?: RequestInit) => {
      cuerpos.push(String(init?.body));
      return new Response(JSON.stringify({ embedding: { values: Array.from({ length: 3072 }, (_, i) => (i % 7) - 3) } }), { status: 200 });
    }) as typeof fetch;
    const [v] = await crearEmbeddingsGemini({ apiKey: "k", fetch: falso }).embeber(["hola"], "RETRIEVAL_DOCUMENT");
    expect(v).toHaveLength(DIMENSIONES);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(JSON.parse(cuerpos[0])).toMatchObject({ taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 });
  });

  it("si un documento cambia, se borran sus chunks viejos; el texto que ya está en otro documento no se duplica", async () => {
    const almacen = crearAlmacenMemoria();
    await ingestar(corpus, almacen, embeddings);
    const viejos = (await almacen.hashesDe("03-honorarios")).length;
    // "03-honorarios" pasa a tener el contenido de la política de turnos (que ya está guardada como 04).
    const cambiado = { ...corpus[2], datos: corpus[3].datos };
    const r = await ingestar([cambiado], almacen, embeddings);
    expect(r.chunksBorrados).toBe(viejos);
    expect(r.chunksNuevos).toBe(0);
    expect(r.duplicadosEvitados).toBe((await almacen.hashesDe("04-politica-turnos")).length);
    expect((await almacen.contar()).hashesRepetidos).toBe(0);
  });
});

describe("búsqueda (match_chunks con embeddings falsos deterministas)", () => {
  const consultas: [string, string, number][] = [
    ["¿Hay receso de verano en enero?", "01-calendario-vencimientos-internos", 3],
    ["¿Cuánto sale el plan Profesional con hasta 120 comprobantes por mes?", "03-honorarios", 1],
    ["¿Hasta cuándo puedo cancelar un turno sin costo?", "04-politica-turnos", 2],
    ["¿Cuándo hacen la recategorización del monotributo?", "05-guia-monotributistas", 2],
    ["¿Cuántos años guardan la documentación?", "10-confidencialidad-datos", 2],
    ["¿Qué día entregan los recibos de sueldo?", "11-guia-empleadores", 1],
  ];

  it.each(consultas)("%s → %s, página %i", async (pregunta, doc, pagina) => {
    const almacen = crearAlmacenMemoria();
    await ingestar(corpus, almacen, embeddings);
    const [q] = await embeddings.embeber([pregunta], "RETRIEVAL_QUERY");
    const [primero] = await almacen.buscar(q, { k: 3, minSimilitud: 0.05 });
    expect([primero?.docSlug, primero?.pagina]).toEqual([doc, pagina]);
  });

  it("el umbral deja afuera lo que no se parece y el filtro limita a un documento", async () => {
    const almacen = crearAlmacenMemoria();
    await ingestar(corpus, almacen, embeddings);
    const [q] = await embeddings.embeber(["receta de empanadas salteñas al horno"], "RETRIEVAL_QUERY");
    expect(await almacen.buscar(q, { k: 5, minSimilitud: 0.3 })).toEqual([]);
    const [q2] = await embeddings.embeber(["honorario"], "RETRIEVAL_QUERY");
    const soloUno = await almacen.buscar(q2, { k: 5, minSimilitud: 0, doc: "11-guia-empleadores" });
    expect(soloUno.length).toBeGreaterThan(0);
    expect(soloUno.every((r) => r.docSlug === "11-guia-empleadores")).toBe(true);
  });

  it("coseno de vectores normalizados: 1 consigo mismo, 0 con uno ortogonal", () => {
    expect(coseno(normalizar([3, 4]), normalizar([3, 4]))).toBeCloseTo(1);
    expect(coseno(normalizar([1, 0]), normalizar([0, 2]))).toBeCloseTo(0);
  });
});
