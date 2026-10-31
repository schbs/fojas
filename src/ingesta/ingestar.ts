// Ingesta idempotente: PDF → páginas → chunks por sección → embeddings solo de lo nuevo → almacén.
// Si un documento no cambió (mismo hash de archivo), no se toca. Si cambió, se agregan los chunks nuevos y se borran los
// que ya no están. Un texto idéntico en dos documentos se guarda una sola vez (deduplicación por hash).
import crypto from "node:crypto";
import type { Almacen } from "@/almacen/tipos";
import type { Embeddings } from "@/ia/embeddings";
import { chunkear } from "./chunking";
import { leerPdf } from "./pdf";

export interface ArchivoPdf {
  slug: string;
  titulo: string;
  datos: Uint8Array;
}

export interface Reporte {
  documentos: number;
  sinCambios: number;
  chunksNuevos: number;
  chunksBorrados: number;
  duplicadosEvitados: number;
  embeddingsPedidos: number;
}

export async function ingestar(archivos: ArchivoPdf[], almacen: Almacen, embeddings: Embeddings): Promise<Reporte> {
  const r: Reporte = { documentos: archivos.length, sinCambios: 0, chunksNuevos: 0, chunksBorrados: 0, duplicadosEvitados: 0, embeddingsPedidos: 0 };
  for (const a of archivos) {
    const hashArchivo = crypto.createHash("sha256").update(a.datos).digest("hex");
    const previo = await almacen.documento(a.slug);
    // Sin cambios solo si el archivo es el mismo Y sus chunks están guardados (una ingesta cortada queda pendiente).
    if (previo?.hashArchivo === hashArchivo && (await almacen.hashesDe(a.slug)).length > 0) {
      r.sinCambios++;
      continue;
    }
    const paginas = await leerPdf(a.datos.slice());
    const chunks = chunkear(paginas);
    const propios = new Set(await almacen.hashesDe(a.slug));
    const enOtros = await almacen.todosLosHashes();
    const vistos = new Set<string>();
    const nuevos = chunks.filter((c) => {
      const repetido = vistos.has(c.hash) || (enOtros.has(c.hash) && !propios.has(c.hash));
      vistos.add(c.hash);
      if (repetido) r.duplicadosEvitados++;
      return !repetido && !propios.has(c.hash);
    });
    const quedan = new Set(chunks.map((c) => c.hash));
    const borrar = [...propios].filter((h) => !quedan.has(h));

    const vectores = nuevos.length ? await embeddings.embeber(nuevos.map((c) => c.contenido), "RETRIEVAL_DOCUMENT") : [];
    r.embeddingsPedidos += nuevos.length;
    // El hash del archivo se guarda al final: si algo falla en el medio, la próxima corrida vuelve a procesar el documento.
    await almacen.guardarDocumento({ slug: a.slug, titulo: a.titulo, hashArchivo: "pendiente", paginas: paginas.length });
    await almacen.agregarChunks(nuevos.map((c, i) => ({ docSlug: a.slug, pagina: c.pagina, seccion: c.seccion, contenido: c.contenido, hash: c.hash, embedding: vectores[i] })));
    if (borrar.length) await almacen.borrarChunks(a.slug, borrar);
    await almacen.guardarDocumento({ slug: a.slug, titulo: a.titulo, hashArchivo, paginas: paginas.length });
    r.chunksNuevos += nuevos.length;
    r.chunksBorrados += borrar.length;
  }
  return r;
}
