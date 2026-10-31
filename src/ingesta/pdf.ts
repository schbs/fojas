// Lectura de PDFs con pdf.js (vía unpdf): texto por página, línea por línea, con el tamaño de letra de cada línea.
// Con el tamaño se distinguen títulos (más grandes que el cuerpo) de membretes y pies (más chicos), sin depender de
// cómo se armó el PDF.
import { getDocumentProxy } from "unpdf";

export interface Linea {
  texto: string;
  tamano: number;
}

export interface PaginaPdf {
  numero: number;
  lineas: Linea[];
}

interface ItemTexto {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

export async function leerPdf(datos: Uint8Array): Promise<PaginaPdf[]> {
  const pdf = await getDocumentProxy(datos);
  const paginas: PaginaPdf[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const contenido = await pagina.getTextContent();
    const lineas: Linea[] = [];
    let texto = "";
    let tamano = 0;
    const cerrar = () => {
      const limpio = texto.replace(/\s+/g, " ").trim();
      if (limpio) lineas.push({ texto: limpio, tamano: Math.round(tamano * 10) / 10 });
      texto = "";
      tamano = 0;
    };
    for (const item of contenido.items as ItemTexto[]) {
      if (typeof item.str !== "string") continue;
      texto += item.str;
      if (item.str.trim()) tamano = Math.max(tamano, Math.abs(item.transform[0]));
      if (item.hasEOL) cerrar();
    }
    cerrar();
    paginas.push({ numero: n, lineas });
  }
  return paginas;
}
