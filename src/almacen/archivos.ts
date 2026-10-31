// PDFs originales de cada documento: el visor los muestra en la página citada y el panel los reingesta.
// En Supabase Storage (bucket privado "documentos", solo el servidor con la clave secreta) o en memoria para los tests.
import fs from "node:fs";
import path from "node:path";

export const BUCKET = "documentos";
// 4 MB: Vercel corta los pedidos de más de 4,5 MB (la subida va en el cuerpo de la server action).
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export interface Archivos {
  nombre: string;
  subir(slug: string, datos: Uint8Array): Promise<void>;
  bajar(slug: string): Promise<Uint8Array | null>;
  borrar(slug: string): Promise<void>;
}

export function crearArchivosSupabase(opciones: { url: string; clave: string; fetch?: typeof fetch }): Archivos {
  const pedirA = opciones.fetch ?? fetch;
  const base = `${opciones.url.replace(/\/$/, "")}/storage/v1`;
  const objeto = (slug: string) => `${base}/object/${BUCKET}/${encodeURIComponent(slug)}.pdf`;
  const auth = { apikey: opciones.clave, Authorization: `Bearer ${opciones.clave}` };
  const fallar = async (r: Response, que: string) => {
    throw new Error(`Storage ${que} → ${r.status}: ${((await r.text().catch(() => "")) || "").slice(0, 200)}`);
  };
  return {
    nombre: "Supabase Storage",
    async subir(slug, datos) {
      const r = await pedirA(objeto(slug), {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/pdf", "x-upsert": "true" },
        body: new Blob([datos.slice()], { type: "application/pdf" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) await fallar(r, "subir");
    },
    async bajar(slug) {
      const r = await pedirA(objeto(slug), { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (r.status === 400 || r.status === 404) return null;
      if (!r.ok) await fallar(r, "bajar");
      return new Uint8Array(await r.arrayBuffer());
    },
    async borrar(slug) {
      const r = await pedirA(objeto(slug), { method: "DELETE", headers: auth, signal: AbortSignal.timeout(20_000) });
      if (!r.ok && r.status !== 400 && r.status !== 404) await fallar(r, "borrar");
    },
  };
}

/** Crea el bucket privado si no existe (lo usa scripts/preparar-storage.ts). */
export async function crearBucket(opciones: { url: string; clave: string }): Promise<"creado" | "ya_estaba"> {
  const r = await fetch(`${opciones.url.replace(/\/$/, "")}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: opciones.clave, Authorization: `Bearer ${opciones.clave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_PDF_BYTES, allowed_mime_types: ["application/pdf"] }),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  if (r.ok) return "creado";
  if (/already exists|Duplicate/i.test(texto)) return "ya_estaba";
  throw new Error(`Storage crear bucket → ${r.status}: ${texto.slice(0, 200)}`);
}

/** En memoria; si se pasa una carpeta, los que no se subieron se leen de ahí (data/corpus/pdf). */
export function crearArchivosMemoria(dir?: string): Archivos {
  const guardados = new Map<string, Uint8Array>();
  return {
    nombre: "memoria",
    async subir(slug, datos) {
      guardados.set(slug, datos.slice());
    },
    async bajar(slug) {
      const propio = guardados.get(slug);
      if (propio) return propio;
      if (!dir || !/^[a-z0-9-]+$/.test(slug)) return null;
      const archivo = path.join(dir, `${slug}.pdf`);
      return fs.existsSync(archivo) ? new Uint8Array(fs.readFileSync(archivo)) : null;
    },
    async borrar(slug) {
      guardados.delete(slug);
    },
  };
}
