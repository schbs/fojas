// Lee los PDFs del corpus (data/corpus/pdf/) con su título (tomado del Markdown fuente).
import fs from "node:fs";
import path from "node:path";
import type { ArchivoPdf } from "./ingestar";

export const DIR_CORPUS = path.join(process.cwd(), "data", "corpus");

export function cargarCorpus(dir = DIR_CORPUS): ArchivoPdf[] {
  return fs
    .readdirSync(path.join(dir, "pdf"))
    .filter((f) => f.endsWith(".pdf"))
    .sort()
    .map((f) => {
      const slug = f.replace(/\.pdf$/, "");
      const md = path.join(dir, `${slug}.md`);
      const titulo = fs.existsSync(md) ? (fs.readFileSync(md, "utf8").match(/^titulo:\s*(.+)$/m)?.[1] ?? slug) : slug;
      return { slug, titulo, datos: new Uint8Array(fs.readFileSync(path.join(dir, "pdf", f))) };
    });
}
