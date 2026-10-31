// Chunking por sección: cada título abre una sección; un chunk nunca mezcla dos secciones ni dos páginas (así la cita
// "documento + página" es exacta). Las secciones largas se parten en trozos de ~800 tokens con ~100 de solapamiento.
import crypto from "node:crypto";
import type { PaginaPdf } from "./pdf";

export const TOKENS_MAX = 800;
export const TOKENS_SOLAPE = 100;
/** Aproximación usada para dimensionar: ~4 caracteres por token en español. */
export const tokensAprox = (texto: string) => Math.ceil(texto.length / 4);

export interface Chunk {
  pagina: number;
  seccion: string;
  contenido: string;
  hash: string;
  tokens: number;
}

/** El tamaño de letra más frecuente es el del cuerpo del texto. */
function tamanoCuerpo(paginas: PaginaPdf[]): number {
  const cuenta = new Map<number, number>();
  for (const p of paginas) for (const l of p.lineas) cuenta.set(l.tamano, (cuenta.get(l.tamano) ?? 0) + l.texto.length);
  return [...cuenta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/** Hash del contenido normalizado (minúsculas y espacios): el mismo texto da el mismo hash aunque cambie el formato. */
export const hashContenido = (texto: string) => crypto.createHash("sha256").update(texto.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");

/** Parte un texto largo en ventanas de ~max tokens con ~solape tokens repetidos, cortando en límites de oración o palabra. */
export function partir(texto: string, max = TOKENS_MAX, solape = TOKENS_SOLAPE): string[] {
  const maxC = max * 4;
  const solapeC = solape * 4;
  if (texto.length <= maxC) return [texto];
  const trozos: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + maxC);
    if (fin < texto.length) {
      const corte = Math.max(texto.lastIndexOf(". ", fin), texto.lastIndexOf("\n", fin));
      fin = corte > inicio + maxC / 2 ? corte + 1 : texto.lastIndexOf(" ", fin) > inicio ? texto.lastIndexOf(" ", fin) : fin;
    }
    trozos.push(texto.slice(inicio, fin).trim());
    if (fin >= texto.length) break;
    const siguiente = fin - solapeC;
    const espacio = texto.indexOf(" ", siguiente);
    inicio = espacio > inicio && espacio < fin ? espacio + 1 : siguiente;
  }
  return trozos;
}

export function chunkear(paginas: PaginaPdf[]): Chunk[] {
  const cuerpo = tamanoCuerpo(paginas);
  const chunks: Chunk[] = [];
  let seccion = "";
  for (const p of paginas) {
    let lineas: string[] = [];
    const volcar = () => {
      const texto = lineas.join("\n").trim();
      lineas = [];
      if (!texto) return;
      for (const trozo of partir(texto)) {
        const contenido = seccion ? `${seccion}\n${trozo}` : trozo;
        chunks.push({ pagina: p.numero, seccion, contenido, hash: hashContenido(contenido), tokens: tokensAprox(contenido) });
      }
    };
    for (const l of p.lineas) {
      if (l.tamano < cuerpo * 0.9) continue; // membrete y pie: letra más chica que el cuerpo
      if (l.tamano >= cuerpo * 1.1) {
        volcar();
        seccion = l.texto;
        continue;
      }
      lineas.push(l.texto);
    }
    volcar();
  }
  return chunks;
}
