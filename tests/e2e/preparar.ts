// Antes de los e2e: borra restos de una corrida anterior y genera el PDF de prueba (documento ficticio que el corpus
// no cubre: después de subirlo, la pregunta sobre mascotas tiene que pasar a responderse con cita).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { DIR_E2E, PDF_PRUEBA } from "./ayudas";
import limpiar from "./limpiar";

const BRAVE = process.env.BRAVE_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "BraveSoftware/Brave-Browser/Application/brave.exe");

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Política de mascotas</title>
<style>@page { size: A4; margin: 22mm 20mm; } body { font-family: Georgia, serif; font-size: 11.5pt; line-height: 1.5; color: #1d1b18; }
h1 { font-size: 20pt; } h2 { font-size: 13pt; margin-top: 16pt; } .pie { font-family: Arial, sans-serif; font-size: 8.5pt; color: #5b554c; margin-top: 24pt; }</style></head>
<body>
<h1>Política de mascotas en la oficina</h1>
<h2>Visitas con mascotas</h2>
<p>Los clientes pueden venir a la oficina del estudio con su perro los días viernes, siempre con correa y solo en la sala de espera.</p>
<h2>Excepciones</h2>
<p>Durante el receso de verano la oficina no recibe mascotas, porque el horario de atención es reducido.</p>
<p class="pie">Página 1 de 1 · Documento ficticio de prueba automática</p>
</body></html>`;

export default async function preparar() {
  await limpiar();
  fs.mkdirSync(DIR_E2E, { recursive: true });
  const navegador = await chromium.launch({ executablePath: BRAVE });
  try {
    const pagina = await navegador.newPage();
    await pagina.setContent(HTML);
    await pagina.pdf({ path: PDF_PRUEBA, format: "A4" });
  } finally {
    await navegador.close();
  }
}
