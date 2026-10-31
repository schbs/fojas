// Almacén en Supabase por la API REST (PostgREST) con la clave secreta, solo del lado del servidor.
// La búsqueda llama a match_chunks (HNSW, coseno, umbral y filtro por documento) y keyword_chunks (tsvector + GIN).
import type { Almacen, ChunkGuardado, Documento } from "./tipos";

export function crearAlmacenSupabase(opciones: { url: string; clave: string; fetch?: typeof fetch }): Almacen {
  const pedirA = opciones.fetch ?? fetch;
  const base = `${opciones.url.replace(/\/$/, "")}/rest/v1`;
  const pedir = async <T>(metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}): Promise<T> => {
    const r = await pedirA(`${base}${ruta}`, {
      method: metodo,
      headers: { apikey: opciones.clave, Authorization: `Bearer ${opciones.clave}`, "Content-Type": "application/json", ...extra },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    // El mensaje de PostgREST dice qué columna o restricción falló (el corpus es ficticio: no hay datos personales).
    if (!r.ok) throw new Error(`Supabase ${metodo} ${ruta.split("?")[0]} → ${r.status}: ${(texto ? (JSON.parse(texto) as { message?: string }).message : "") ?? ""}`);
    return (texto ? JSON.parse(texto) : null) as T;
  };
  const hashes = async (filtro: string) => (await pedir<{ hash: string }[]>("GET", `/chunks?select=hash${filtro}`)).map((x) => x.hash);

  return {
    nombre: "Supabase",
    async documento(slug) {
      const r = await pedir<{ slug: string; titulo: string; hash_archivo: string; paginas: number }[]>("GET", `/documents?slug=eq.${encodeURIComponent(slug)}&select=*`);
      return r[0] ? { slug: r[0].slug, titulo: r[0].titulo, hashArchivo: r[0].hash_archivo, paginas: r[0].paginas } : null;
    },
    async listarDocumentos() {
      // chunks(count) es el conteo embebido de PostgREST por la clave foránea.
      const r = await pedir<{ slug: string; titulo: string; paginas: number; chunks: { count: number }[] }[]>("GET", "/documents?select=slug,titulo,paginas,chunks(count)&order=slug");
      return r.map((d) => ({ slug: d.slug, titulo: d.titulo, paginas: d.paginas, chunks: d.chunks[0]?.count ?? 0 }));
    },
    async chunksDe(slug) {
      const r = await pedir<{ page: number; section: string; contenido: string }[]>("GET", `/chunks?doc_slug=eq.${encodeURIComponent(slug)}&select=page,section,contenido&order=page,id`);
      return r.map((c) => ({ pagina: c.page, seccion: c.section, contenido: c.contenido }));
    },
    async borrarDocumento(slug) {
      await pedir("DELETE", `/documents?slug=eq.${encodeURIComponent(slug)}`);
    },
    async guardarDocumento(d: Documento) {
      await pedir("POST", "/documents?on_conflict=slug", { slug: d.slug, titulo: d.titulo, hash_archivo: d.hashArchivo, paginas: d.paginas }, { Prefer: "resolution=merge-duplicates" });
    },
    hashesDe: (slug) => hashes(`&doc_slug=eq.${encodeURIComponent(slug)}`),
    todosLosHashes: async () => new Set(await hashes("")),
    async agregarChunks(chunks: ChunkGuardado[]) {
      if (!chunks.length) return;
      await pedir("POST", "/chunks", chunks.map((c) => ({ doc_slug: c.docSlug, page: c.pagina, section: c.seccion, contenido: c.contenido, hash: c.hash, embedding: JSON.stringify(c.embedding) })));
    },
    async borrarChunks(slug, lista) {
      if (!lista.length) return;
      await pedir("DELETE", `/chunks?doc_slug=eq.${encodeURIComponent(slug)}&hash=in.(${lista.join(",")})`);
    },
    async contar() {
      const docs = await pedir<unknown[]>("GET", "/documents?select=slug");
      const todos = await hashes("");
      return { documentos: docs.length, chunks: todos.length, hashesRepetidos: todos.length - new Set(todos).size };
    },
    async buscar(embedding, { k, minSimilitud, doc }) {
      const r = await pedir<{ doc_slug: string; titulo: string; page: number; section: string; contenido: string; similarity: number }[]>("POST", "/rpc/match_chunks", {
        query_embedding: JSON.stringify(embedding),
        k,
        min_similarity: minSimilitud,
        filtro_doc: doc ?? null,
      });
      return r.map((x) => ({ docSlug: x.doc_slug, titulo: x.titulo, pagina: x.page, seccion: x.section, contenido: x.contenido, similitud: x.similarity }));
    },
    async buscarPalabras(texto, embedding, { k, doc }) {
      const r = await pedir<{ doc_slug: string; titulo: string; page: number; section: string; contenido: string; similarity: number; rank: number }[]>("POST", "/rpc/keyword_chunks", {
        query_text: texto,
        query_embedding: JSON.stringify(embedding),
        k,
        filtro_doc: doc ?? null,
      });
      return r.map((x) => ({ docSlug: x.doc_slug, titulo: x.titulo, pagina: x.page, seccion: x.section, contenido: x.contenido, similitud: x.similarity, rango: x.rank }));
    },
    async registrarSinEvidencia({ pregunta, mejorSimilitud, motivo }) {
      await pedir("POST", "/unanswered", { pregunta: pregunta.slice(0, 1000), mejor_similitud: mejorSimilitud, motivo }, { Prefer: "return=minimal" });
    },
    async sinEvidencia(limite) {
      const r = await pedir<{ pregunta: string; mejor_similitud: number | null; motivo: "umbral" | "modelo" | "citas"; creado_en: string }[]>(
        "GET",
        `/unanswered?select=pregunta,mejor_similitud,motivo,creado_en&order=creado_en.desc&limit=${limite}`,
      );
      return r.map((x) => ({ pregunta: x.pregunta, mejorSimilitud: x.mejor_similitud, motivo: x.motivo, creadoEn: x.creado_en }));
    },
  };
}
