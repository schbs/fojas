import { describe, expect, it } from "vitest";
import { chunkear, hashContenido, partir, tokensAprox, TOKENS_MAX } from "@/ingesta/chunking";
import { cargarCorpus } from "@/ingesta/corpus";
import { leerPdf } from "@/ingesta/pdf";

const corpus = cargarCorpus();
const pdf = (slug: string) => corpus.find((a) => a.slug === slug)!.datos.slice();

describe("lectura de PDF", () => {
  it("lee las 27 páginas del corpus, con el tamaño de letra de cada línea", async () => {
    let paginas = 0;
    for (const a of corpus) paginas += (await leerPdf(a.datos.slice())).length;
    expect(corpus).toHaveLength(12);
    expect(paginas).toBe(27);
  });
});

describe("chunking por sección", () => {
  it("los títulos abren secciones y cada chunk queda en su página (circular de honorarios)", async () => {
    const chunks = chunkear(await leerPdf(pdf("03-honorarios")));
    expect(chunks.map((c) => [c.pagina, c.seccion])).toEqual([
      [1, "Valores de referencia"],
      [1, "Planes mensuales"],
      [2, "Trámites fuera del plan"],
      [2, "Actualización"],
      [2, "Forma de pago"],
    ]);
    expect(chunks[1].contenido).toContain("Profesional Personas con hasta 120 comprobantes por mes ARS 64.000");
  });

  it("deja afuera el membrete y el pie de página (letra más chica que el cuerpo)", async () => {
    for (const a of corpus) {
      for (const c of chunkear(await leerPdf(a.datos.slice()))) {
        expect(c.contenido).not.toMatch(/Documento ficticio de demostración|Página \d+ de \d+|RUCA-[A-Z]{3}-\d\d ·/);
      }
    }
  });

  it("ningún chunk mezcla dos secciones: cada contenido empieza con el título de su sección", async () => {
    const chunks = chunkear(await leerPdf(pdf("06-preguntas-frecuentes")));
    expect(chunks.length).toBe(9);
    for (const c of chunks) expect(c.contenido.startsWith(`${c.seccion}\n`)).toBe(true);
  });

  it("una sección larga se parte en ventanas de ≤ 800 tokens con ~100 de solapamiento", () => {
    const oraciones = Array.from({ length: 400 }, (_, i) => `Oración número ${i} del texto largo de prueba.`);
    const trozos = partir(oraciones.join(" "));
    expect(trozos.length).toBeGreaterThan(2);
    for (const t of trozos) expect(tokensAprox(t)).toBeLessThanOrEqual(TOKENS_MAX);
    for (let i = 1; i < trozos.length; i++) {
      // El principio de cada ventana repite el final de la anterior (~100 tokens = ~400 caracteres).
      const inicio = trozos[i].slice(0, 40);
      expect(trozos[i - 1].includes(inicio)).toBe(true);
      expect(trozos[i - 1].length - trozos[i - 1].indexOf(inicio)).toBeLessThanOrEqual(500);
    }
  });

  it("un texto corto queda entero", () => {
    expect(partir("Hola mundo.")).toEqual(["Hola mundo."]);
  });

  it("el hash no cambia con mayúsculas ni espacios, y cambia con el contenido", () => {
    expect(hashContenido("Hola   Mundo\n")).toBe(hashContenido("hola mundo"));
    expect(hashContenido("hola mundo")).not.toBe(hashContenido("hola mundos"));
  });
});
