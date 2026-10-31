// Convierte los 12 documentos ficticios de data/corpus/*.md en PDFs A4 (data/corpus/pdf/), con una hoja por cada
// bloque separado por "<!-- pagina -->" y el pie "Página n de N · Documento ficticio de demostración".
// Uso: npm run corpus:pdf          (imprime con Brave, ya instalado: no se descargan navegadores)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const DIR = path.join("data", "corpus");
const SALIDA = path.join(DIR, "pdf");
const BRAVE = process.env.BRAVE_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "BraveSoftware/Brave-Browser/Application/brave.exe");

const escapar = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const enLinea = (s: string) => escapar(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/"(.+?)"/g, "“$1”");

/** Markdown mínimo (títulos, listas, tablas y párrafos): alcanza para los documentos del estudio. */
function aHtml(md: string): string {
  const salida: string[] = [];
  const lineas = md.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l || l === "---") continue;
    if (l.startsWith("# ")) salida.push(`<h1>${enLinea(l.slice(2))}</h1>`);
    else if (l.startsWith("## ")) salida.push(`<h2>${enLinea(l.slice(3))}</h2>`);
    else if (/^(- |\d+\. )/.test(l)) {
      const ordenada = /^\d+\. /.test(l);
      const items: string[] = [];
      while (i < lineas.length && /^(- |\d+\. )/.test(lineas[i].trim())) items.push(`<li>${enLinea(lineas[i++].trim().replace(/^(- |\d+\. )/, ""))}</li>`);
      i--;
      salida.push(ordenada ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else if (l.startsWith("|")) {
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith("|")) {
        const celdas = lineas[i++].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!celdas.every((c) => /^-+$/.test(c))) filas.push(celdas);
      }
      i--;
      const [cab, ...cuerpo] = filas;
      salida.push(`<table><thead><tr>${cab.map((c) => `<th>${enLinea(c)}</th>`).join("")}</tr></thead><tbody>${cuerpo.map((f) => `<tr>${f.map((c) => `<td>${enLinea(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if (l !== "Documento ficticio de demostración.") {
      const parrafo: string[] = [l];
      while (i + 1 < lineas.length && lineas[i + 1].trim() && !/^(#|- |\d+\. |\||---)/.test(lineas[i + 1].trim())) parrafo.push(lineas[++i].trim());
      salida.push(`<p>${enLinea(parrafo.join(" "))}</p>`);
    }
  }
  return salida.join("\n");
}

const ESTILO = `
  @page { size: A4; margin: 22mm 20mm 24mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1d1b18; font-size: 11.5pt; line-height: 1.5; }
  .hoja { break-after: page; } .hoja:last-child { break-after: auto; }
  .membrete { font-family: Arial, sans-serif; font-size: 8.5pt; color: #5b554c; border-bottom: 1px solid #b9b1a3; padding-bottom: 4pt; margin-bottom: 14pt; display: flex; justify-content: space-between; }
  h1 { font-size: 20pt; margin: 0 0 12pt; } h2 { font-size: 13pt; margin: 16pt 0 6pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; } th, td { border: 1px solid #b9b1a3; padding: 4pt 6pt; text-align: left; }
  .pie { font-family: Arial, sans-serif; font-size: 8.5pt; color: #5b554c; border-top: 1px solid #b9b1a3; margin-top: 18pt; padding-top: 4pt; }
`;

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivos = fs.readdirSync(DIR).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
  const navegador = await chromium.launch({ executablePath: BRAVE });
  try {
    const pagina = await navegador.newPage();
    for (const archivo of archivos) {
      const crudo = fs.readFileSync(path.join(DIR, archivo), "utf8");
      const frente = Object.fromEntries([...(crudo.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").matchAll(/^(\w+):\s*(.+)$/gm)].map((m) => [m[1], m[2]]));
      const cuerpo = crudo.replace(/^---\n[\s\S]*?\n---\n/, "");
      const hojas = cuerpo.split("<!-- pagina -->");
      const html = hojas
        .map(
          (h, i) => `<section class="hoja">
            <div class="membrete"><span>Estudio Ruca &amp; Asociados</span><span>${escapar(frente.codigo)} · ${escapar(frente.fecha)}</span></div>
            ${aHtml(h)}
            <div class="pie">Página ${i + 1} de ${hojas.length} · Documento ficticio de demostración</div>
          </section>`,
        )
        .join("");
      await pagina.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(frente.titulo)}</title><style>${ESTILO}</style></head><body>${html}</body></html>`);
      await pagina.pdf({ path: path.join(SALIDA, archivo.replace(/\.md$/, ".pdf")), format: "A4", printBackground: true });
      console.log(`✓ ${archivo.replace(/\.md$/, ".pdf")} (${hojas.length} páginas)`);
    }
  } finally {
    await navegador.close();
  }
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
