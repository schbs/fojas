// Puerto del almacén de vectores: Supabase (pgvector, función match_chunks) o memoria (tests y corridas sin cuenta).

export interface Documento {
  slug: string;
  titulo: string;
  hashArchivo: string;
  paginas: number;
}

export interface ChunkGuardado {
  docSlug: string;
  pagina: number;
  seccion: string;
  contenido: string;
  hash: string;
  embedding: number[];
}

export interface Resultado {
  docSlug: string;
  titulo: string;
  pagina: number;
  seccion: string;
  contenido: string;
  similitud: number;
}

/** Resultado de la búsqueda por palabras: rango de texto (ts_rank_cd o equivalente) y similitud coseno con la pregunta. */
export interface ResultadoPalabras extends Resultado {
  rango: number;
}

export type MotivoSinEvidencia = "umbral" | "modelo" | "citas";

export interface SinEvidencia {
  pregunta: string;
  mejorSimilitud: number | null;
  motivo: MotivoSinEvidencia;
  creadoEn?: string;
}

/** Fila del panel: el documento con cuántos chunks tiene guardados. */
export interface ResumenDocumento {
  slug: string;
  titulo: string;
  paginas: number;
  chunks: number;
}

export interface ChunkVista {
  pagina: number;
  seccion: string;
  contenido: string;
}

export interface Almacen {
  nombre: string;
  documento(slug: string): Promise<Documento | null>;
  listarDocumentos(): Promise<ResumenDocumento[]>;
  chunksDe(slug: string): Promise<ChunkVista[]>;
  /** Borra el documento y sus chunks (en la base, por el on delete cascade). */
  borrarDocumento(slug: string): Promise<void>;
  guardarDocumento(doc: Documento): Promise<void>;
  /** Hashes de los chunks guardados de un documento. */
  hashesDe(slug: string): Promise<string[]>;
  /** Hashes guardados de todos los documentos (para no duplicar un texto que aparece en dos documentos). */
  todosLosHashes(): Promise<Set<string>>;
  agregarChunks(chunks: ChunkGuardado[]): Promise<void>;
  borrarChunks(slug: string, hashes: string[]): Promise<void>;
  contar(): Promise<{ documentos: number; chunks: number; hashesRepetidos: number }>;
  /** Equivale a match_chunks(query_embedding, k, min_similarity, doc): top k por coseno, por encima del umbral. */
  buscar(embedding: number[], opciones: { k: number; minSimilitud: number; doc?: string }): Promise<Resultado[]>;
  /** Equivale a keyword_chunks(query_text, query_embedding, k, doc): palabras de la pregunta unidas con OR, top k por rango. */
  buscarPalabras(texto: string, embedding: number[], opciones: { k: number; doc?: string }): Promise<ResultadoPalabras[]>;
  registrarSinEvidencia(registro: SinEvidencia): Promise<void>;
  sinEvidencia(limite: number): Promise<SinEvidencia[]>;
}
