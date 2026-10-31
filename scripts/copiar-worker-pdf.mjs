// Copia el worker de pdf.js a public/ (corre antes de dev y build): el visor lo carga como archivo estático, sin
// depender de cómo el empaquetador resuelve import.meta.url.
import fs from "node:fs";
import path from "node:path";

const origen = path.join("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
fs.mkdirSync("public", { recursive: true });
fs.copyFileSync(origen, path.join("public", "pdf.worker.min.mjs"));
