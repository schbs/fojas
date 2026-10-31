// Almacén en memoria con la misma semántica que la base: hash único por chunk, búsqueda por coseno con umbral y por
// palabras (OR de los términos, la sección pesa el doble como el setweight A de la migración).
import { coseno } from "@/ia/embeddings";
import { terminos } from "@/rag/texto";
import type { Almacen, ChunkGuardado, Documento, SinEvidencia } from "./tipos";

export function crearAlmacenMemoria(): Almacen {
  const documentos = new Map<string, Documento>();
  let chunks: ChunkGuardado[] = [];
  const sinEvidencia: SinEvidencia[] = [];
  return {
    nombre: "memoria",
    async documento(slug) {
      return documentos.get(slug) ?? null;
    },
    async guardarDocumento(doc) {
      documentos.set(doc.slug, doc);
    },
    async listarDocumentos() {
      return [...documentos.values()]
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((d) => ({ slug: d.slug, titulo: d.titulo, paginas: d.paginas, chunks: chunks.filter((c) => c.docSlug === d.slug).length }));
    },
    async chunksDe(slug) {
      return chunks.filter((c) => c.docSlug === slug).map((c) => ({ pagina: c.pagina, seccion: c.seccion, contenido: c.contenido })).sort((a, b) => a.pagina - b.pagina);
    },
    async borrarDocumento(slug) {
      documentos.delete(slug);
      chunks = chunks.filter((c) => c.docSlug !== slug);
    },
    async hashesDe(slug) {
      return chunks.filter((c) => c.docSlug === slug).map((c) => c.hash);
    },
    async todosLosHashes() {
      return new Set(chunks.map((c) => c.hash));
    },
    async agregarChunks(nuevos) {
      for (const c of nuevos) {
        if (chunks.some((x) => x.hash === c.hash)) throw new Error(`hash repetido: ${c.hash}`); // igual que el UNIQUE de la base
        chunks.push(c);
      }
    },
    async borrarChunks(slug, hashes) {
      const quitar = new Set(hashes);
      chunks = chunks.filter((c) => !(c.docSlug === slug && quitar.has(c.hash)));
    },
    async contar() {
      const hashes = chunks.map((c) => c.hash);
      return { documentos: documentos.size, chunks: chunks.length, hashesRepetidos: hashes.length - new Set(hashes).size };
    },
    async buscar(embedding, { k, minSimilitud, doc }) {
      return chunks
        .filter((c) => !doc || c.docSlug === doc)
        .map((c) => ({ docSlug: c.docSlug, titulo: documentos.get(c.docSlug)?.titulo ?? c.docSlug, pagina: c.pagina, seccion: c.seccion, contenido: c.contenido, similitud: coseno(embedding, c.embedding) }))
        .filter((r) => r.similitud >= minSimilitud)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, k);
    },
    async buscarPalabras(texto, embedding, { k, doc }) {
      const pedidos = new Set(terminos(texto));
      if (!pedidos.size) return [];
      // Peso de cada término: más raro en el corpus, más informativo (idf).
      const enChunk = chunks.map((c) => ({ c, seccion: new Set(terminos(c.seccion)), cuerpo: terminos(c.contenido) }));
      const idf = (p: string) => Math.log(1 + chunks.length / (1 + enChunk.filter((x) => x.seccion.has(p) || x.cuerpo.includes(p)).length));
      return enChunk
        .filter((x) => !doc || x.c.docSlug === doc)
        .map((x) => ({
          x,
          rango: [...pedidos].reduce((s, p) => s + idf(p) * ((x.seccion.has(p) ? 2 : 0) + Math.min(3, x.cuerpo.filter((q) => q === p).length)), 0),
        }))
        .filter((r) => r.rango > 0)
        .sort((a, b) => b.rango - a.rango)
        .slice(0, k)
        .map(({ x: { c }, rango }) => ({ docSlug: c.docSlug, titulo: documentos.get(c.docSlug)?.titulo ?? c.docSlug, pagina: c.pagina, seccion: c.seccion, contenido: c.contenido, similitud: coseno(embedding, c.embedding), rango }));
    },
    async registrarSinEvidencia(registro) {
      sinEvidencia.push({ ...registro, creadoEn: new Date().toISOString() });
    },
    async sinEvidencia(limite) {
      return sinEvidencia.slice(-limite).reverse();
    },
  };
}
