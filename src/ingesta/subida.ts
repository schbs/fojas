// Validación de un PDF subido desde el panel y slug a partir del título (funciones puras, con tests).
import { z } from "zod";
import { MAX_PDF_BYTES } from "@/almacen/archivos";
import { sinTildes } from "@/rag/texto";

export const PREFIJO_SUBIDO = "subido-";

export const tituloSchema = z.string().trim().min(3).max(120);

/** "Política de mascotas" → "subido-politica-de-mascotas". Los documentos subidos se distinguen del corpus por el prefijo. */
export function slugDeTitulo(titulo: string): string {
  const base = sinTildes(titulo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${PREFIJO_SUBIDO}${base || "documento"}`;
}

export type ProblemaPdf = "vacio" | "grande" | "no_pdf";

/** null si el archivo sirve; si no, el motivo (el panel lo muestra en su idioma). */
export function problemaDelPdf(archivo: { size: number; type: string }, inicio: Uint8Array): ProblemaPdf | null {
  if (!archivo.size) return "vacio";
  if (archivo.size > MAX_PDF_BYTES) return "grande";
  const firma = new TextDecoder().decode(inicio.slice(0, 5));
  if (firma !== "%PDF-" || (archivo.type && archivo.type !== "application/pdf")) return "no_pdf";
  return null;
}
