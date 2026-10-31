// Componente de cliente (lo usa Chat.tsx). Visor del PDF original en la página citada, con la frase de la cita resaltada. pdf.js se carga recién al abrir una
// cita (no pesa en la carga de la página) y dibuja la hoja en un canvas; el resaltado sale de las líneas de texto de
// esa página que forman parte de la cita.
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TEXTOS, type Idioma } from "@/i18n/textos";
import { paraComparar } from "@/rag/texto";

export interface CitaAbierta {
  doc: string;
  titulo: string;
  pagina: number;
  fragmento: string;
}

type Marca = { left: number; top: number; width: number; height: number };

const cargarPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
};

/** Líneas de la página que están dentro de la cita (las muy cortas no cuentan: "de la" aparece en todos lados). */
export function lineasCitadas(lineas: string[], fragmento: string): boolean[] {
  const cita = paraComparar(fragmento);
  return lineas.map((l) => {
    const t = paraComparar(l);
    return t.length >= 10 && cita.includes(t);
  });
}

export function VisorPdf({ cita, alCerrar, idioma }: { cita: CitaAbierta | null; alCerrar: () => void; idioma: Idioma }) {
  const t = TEXTOS[idioma].visor;
  const dialogo = useRef<HTMLDialogElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const hoja = useRef<HTMLDivElement>(null);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  // La página que se ve: la citada, salvo que se haya navegado dentro de esta misma cita.
  const [navegada, setNavegada] = useState<{ para: CitaAbierta | null; pagina: number }>({ para: null, pagina: 1 });
  const pagina = cita && navegada.para === cita ? navegada.pagina : (cita?.pagina ?? 1);
  const irA = (p: number) => setNavegada({ para: cita, pagina: p });
  // Lo que llega de forma asíncrona queda asociado a qué documento y qué página corresponde: así lo viejo no se mezcla.
  const [cargado, setCargado] = useState<{ doc: string; total: number } | { doc: string; error: true } | null>(null);
  const [dibujo, setDibujo] = useState<{ clave: string; marcas: Marca[]; error?: boolean } | null>(null);

  const doc = cita?.doc;
  const clave = cita ? `${cita.doc}|${cita.pagina}|${cita.fragmento}|${pagina}` : "";
  const docListo = cargado && cargado.doc === doc && "total" in cargado ? cargado : null;
  const total = docListo?.total ?? null;
  const estado: "cargando" | "listo" | "error" =
    (cargado && cargado.doc === doc && "error" in cargado) || (dibujo?.clave === clave && dibujo.error) ? "error" : dibujo?.clave === clave ? "listo" : "cargando";
  const marcas = dibujo?.clave === clave ? dibujo.marcas : null;

  // Llevar la frase resaltada a la vista (en el celular la hoja es más alta que la pantalla).
  useEffect(() => {
    if (marcas?.length) hoja.current?.querySelector(".resaltado-pdf")?.scrollIntoView({ block: "center" });
  }, [marcas]);

  // Abrir y cerrar el <dialog> modal según haya una cita elegida.
  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (cita && !d.open) d.showModal();
    else if (!cita && d.open) d.close();
  }, [cita]);

  // Cargar el documento cuando cambia.
  useEffect(() => {
    if (!doc) return;
    let vivo = true;
    (async () => {
      const pdfjs = await cargarPdfjs();
      const documento = await pdfjs.getDocument({ url: `/documentos/${doc}` }).promise;
      if (!vivo) return void documento.destroy();
      pdf.current = documento;
      setCargado({ doc, total: documento.numPages });
    })().catch(() => vivo && setCargado({ doc, error: true }));
    return () => {
      vivo = false;
      void pdf.current?.destroy();
      pdf.current = null;
    };
  }, [doc]);

  // Dibujar la página pedida y, si es la citada, calcular el resaltado.
  const paginaCitada = cita?.pagina;
  const fragmento = cita?.fragmento;
  useEffect(() => {
    const documento = pdf.current;
    const canvas = lienzo.current;
    const contenedor = hoja.current;
    if (!docListo || !documento || !canvas || !contenedor) return;
    let tarea: RenderTask | null = null;
    let vivo = true;
    (async () => {
      const pdfjs = await cargarPdfjs();
      const p = await documento.getPage(Math.min(Math.max(1, pagina), documento.numPages));
      const escala = contenedor.clientWidth / p.getViewport({ scale: 1 }).width;
      const vista = p.getViewport({ scale: escala });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vista.width * dpr);
      canvas.height = Math.floor(vista.height * dpr);
      canvas.style.width = `${vista.width}px`;
      canvas.style.height = `${vista.height}px`;
      tarea = p.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: p.getViewport({ scale: escala * dpr }) });
      await tarea.promise;
      if (!vivo) return;
      let nuevas: Marca[] = [];
      if (pagina === paginaCitada && fragmento) {
        const items = (await p.getTextContent()).items.filter((i) => "str" in i) as { str: string; transform: number[]; width: number }[];
        const citadas = lineasCitadas(
          items.map((i) => i.str),
          fragmento,
        );
        nuevas = items
          .filter((_, i) => citadas[i])
          .map((i) => {
            const t = pdfjs.Util.transform(vista.transform, i.transform);
            const alto = Math.hypot(t[2], t[3]);
            return { left: t[4] - 2, top: t[5] - alto, width: i.width * escala + 4, height: alto * 1.25 };
          });
      }
      if (vivo) setDibujo({ clave, marcas: nuevas });
    })().catch((e: unknown) => {
      if (vivo && (e as { name?: string })?.name !== "RenderingCancelledException") setDibujo({ clave, marcas: [], error: true });
    });
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [docListo, pagina, paginaCitada, fragmento, clave]);

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="visor-titulo"
      onClose={alCerrar}
      onClick={(e) => e.target === dialogo.current && dialogo.current?.close()}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-papel p-0 text-tinta sm:m-auto sm:h-[92dvh] sm:max-w-3xl sm:border sm:border-tinta"
    >
      {cita && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-regla px-4 py-3">
            <div className="min-w-0">
              <h2 id="visor-titulo" className="font-display text-lg leading-snug font-medium">
                {cita.titulo}
              </h2>
              <p className="text-sm text-tinta-suave">
                {t.pagina(pagina, total)}
                {pagina === cita.pagina ? t.laCitada : ""}
              </p>
            </div>
            <button type="button" onClick={() => dialogo.current?.close()} className="min-h-11 shrink-0 border border-borde px-3 text-sm font-semibold hover:bg-acero-claro">
              {t.cerrar}
            </button>
          </div>

          <p className="border-b border-regla bg-papel-hondo px-4 py-2 text-sm leading-relaxed">
            <span className="font-semibold">{t.fraseCitada}</span> <mark className="bg-marcador px-0.5 text-tinta">«{cita.fragmento}»</mark>
          </p>

          <div className="flex-1 overflow-auto bg-papel-hondo p-3">
            <div ref={hoja} className="relative mx-auto w-full max-w-2xl bg-blanco shadow-sm">
              <canvas ref={lienzo} aria-label={t.imagen(pagina, cita.titulo)} role="img" className="block" />
              {marcas?.map((m, i) => (
                <span key={i} aria-hidden="true" className="resaltado-pdf pointer-events-none absolute" style={{ left: m.left, top: m.top, width: m.width, height: m.height }} />
              ))}
              {estado === "cargando" && <p className="absolute inset-x-0 top-6 text-center text-sm text-tinta-suave">{t.cargando}</p>}
              {estado === "error" && (
                <p role="alert" className="p-6 text-center text-base text-error">
                  {t.noAbre} <a href={`/documentos/${cita.doc}#page=${pagina}`} className="underline">
                    {t.abrirPdf}
                  </a>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-regla px-4 py-3">
            <button type="button" onClick={() => irA(pagina - 1)} disabled={pagina <= 1} className="min-h-11 border border-borde px-3 text-sm disabled:opacity-50">
              {t.anterior}
            </button>
            <a href={`/documentos/${cita.doc}#page=${pagina}`} target="_blank" rel="noopener" className="min-h-11 content-center text-sm underline underline-offset-4">
              {t.abrirCompleto}
            </a>
            <button type="button" onClick={() => irA(pagina + 1)} disabled={!total || pagina >= total} className="min-h-11 border border-borde px-3 text-sm disabled:opacity-50">
              {t.siguiente}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
