"use client";
// Chat con streaming: /api/ask manda cada etapa (buscando → fuentes → redactando → respuesta) en NDJSON. El texto de la
// respuesta aparece recién cuando sus citas ya se validaron contra los documentos: nunca se muestra algo sin sostén.
import { useRef, useState } from "react";
import type { EventoAsk } from "@/api/ask";
import { TEXTOS, type Idioma, type Textos } from "@/i18n/textos";
import type { Respuesta } from "@/rag/responder";
import { VisorPdf, type CitaAbierta } from "./VisorPdf";

type Fuente = { doc: string; titulo: string; pagina: number; seccion: string };

interface Intercambio {
  id: number;
  pregunta: string;
  estado: "buscando" | "redactando" | "listo" | "error";
  fuentes: Fuente[];
  respuesta?: Respuesta;
  error?: string;
}

const MAX = 500;

export function Chat({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].chat;
  const [lista, setLista] = useState<Intercambio[]>([]);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [cita, setCita] = useState<CitaAbierta | null>(null);
  const siguiente = useRef(1);
  const campo = useRef<HTMLTextAreaElement>(null);
  const ocupado = lista.some((x) => x.estado === "buscando" || x.estado === "redactando");

  const actualizar = (id: number, cambio: Partial<Intercambio>) => setLista((l) => l.map((x) => (x.id === id ? { ...x, ...cambio } : x)));

  async function preguntar(pregunta: string) {
    const limpia = pregunta.trim();
    if (limpia.length < 3) {
      setAviso(t.corta);
      campo.current?.focus();
      return;
    }
    setAviso(null);
    setTexto("");
    const id = siguiente.current++;
    setLista((l) => [...l, { id, pregunta: limpia, estado: "buscando", fuentes: [] }]);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ pregunta: limpia, idioma }),
      });
      if (!r.ok || !r.body) {
        // Los mensajes salen del diccionario según el código (el servidor responde en español).
        actualizar(id, { estado: "error", error: r.status === 429 ? t.demasiadas : r.status === 400 ? t.larga : t.noDisponible });
        return;
      }
      const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = "";
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += value;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const linea of lineas) if (linea.trim()) aplicar(id, JSON.parse(linea) as EventoAsk);
      }
    } catch {
      actualizar(id, { estado: "error", error: t.sinConexion });
    }
  }

  function aplicar(id: number, e: EventoAsk) {
    if (e.tipo === "fuentes") actualizar(id, { fuentes: e.fuentes });
    else if (e.tipo === "redactando") actualizar(id, { estado: "redactando" });
    else if (e.tipo === "respuesta") actualizar(id, { estado: "listo", respuesta: e.respuesta });
    else if (e.tipo === "error") actualizar(id, { estado: "error", error: t.noDisponible });
  }

  return (
    <section aria-label={t.conversacion} className="pb-6">
      {lista.length === 0 && (
        <div className="py-6">
          <p className="text-sm font-semibold tracking-wide text-tinta-suave uppercase">{t.paraProbar}</p>
          <ul className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {t.sugeridas.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => preguntar(s)}
                  className="min-h-11 w-full border border-borde px-3 py-2 text-left text-sm transition-colors hover:bg-acero-claro sm:w-auto"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="mt-4">
        {lista.map((x, i) => (
          <li key={x.id}>
            <Foja numero={i + 1} intercambio={x} alAbrir={setCita} t={t} />
          </li>
        ))}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ocupado) void preguntar(texto);
        }}
        className="sticky bottom-0 mt-4 border-t border-tinta bg-papel pt-3 pb-4"
      >
        <label htmlFor="pregunta" className="text-sm font-semibold">
          {t.tuConsulta}
        </label>
        <div className="mt-1 flex items-stretch gap-2">
          <textarea
            id="pregunta"
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!ocupado) void preguntar(texto);
              }
            }}
            rows={2}
            maxLength={MAX}
            aria-describedby="ayuda-pregunta"
            aria-invalid={aviso ? true : undefined}
            placeholder={t.ejemplo}
            className="min-h-12 flex-1 resize-none border border-borde bg-blanco px-3 py-2 text-base placeholder:text-tinta-suave"
          />
          <button type="submit" disabled={ocupado} className="min-h-12 bg-acero px-4 text-base font-semibold text-blanco transition-colors hover:bg-acero-hondo disabled:opacity-60">
            {t.preguntar}
          </button>
        </div>
        {aviso ? (
          <p id="ayuda-pregunta" role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-error">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current">
              <path d="M10 1.5 19 18H1L10 1.5Zm-1 6v5h2v-5H9Zm0 6.5v2h2v-2H9Z" />
            </svg>
            {aviso}
          </p>
        ) : (
          <p id="ayuda-pregunta" className="mt-2 text-sm text-tinta-suave">
            {t.ayuda(texto.length, MAX)}
          </p>
        )}
      </form>

      <VisorPdf cita={cita} alCerrar={() => setCita(null)} idioma={idioma} />
    </section>
  );
}

function Foja({ numero, intercambio: x, alAbrir, t }: { numero: number; intercambio: Intercambio; alAbrir: (c: CitaAbierta) => void; t: Textos["chat"] }) {
  const r = x.respuesta;
  return (
    <article aria-labelledby={`consulta-${x.id}`} className="grid gap-4 border-t border-regla py-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
      <div className="min-w-0">
        <p className="text-sm text-tinta-suave">
          <span className="font-semibold tracking-wide uppercase">
            {t.foja} {numero}
          </span>{" "}
          · {t.consulta}
        </p>
        <h2 id={`consulta-${x.id}`} className="mt-1 font-display text-xl leading-snug font-medium">
          {x.pregunta}
        </h2>

        <div aria-live="polite" className="mt-3">
          {(x.estado === "buscando" || x.estado === "redactando") && <Progreso intercambio={x} t={t} />}
          {x.estado === "listo" && r && !r.sin_evidencia && (
            <p className="max-w-prose text-base leading-relaxed motion-safe:animate-[aparecer_300ms_var(--ease-foja)]">{r.respuesta}</p>
          )}
          {x.estado === "listo" && r?.sin_evidencia && (
            <div className="max-w-prose border-l-2 border-tinta py-1 pl-4">
              <p className="flex items-center gap-2 font-semibold">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-current">
                  <path d="M3 4h14v9H8l-4 3v-3H3V4Zm2 2v5h1v1.5L8 11h7V6H5Z" />
                </svg>
                {t.derivada}
              </p>
              <p className="mt-1 text-base leading-relaxed">{r.respuesta}</p>
              <p className="mt-1 text-sm text-tinta-suave">{t.registrada}</p>
            </div>
          )}
          {x.estado === "error" && (
            <p role="alert" className="flex items-center gap-2 text-base text-error">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 fill-current">
                <path d="M10 1.5 19 18H1L10 1.5Zm-1 6v5h2v-5H9Zm0 6.5v2h2v-2H9Z" />
              </svg>
              {x.error}
            </p>
          )}
        </div>
      </div>

      {r && !r.sin_evidencia && (
        <aside aria-label={t.fuentesDe(numero)} className="lg:border-l lg:border-regla lg:pl-6">
          <p className="text-sm font-semibold tracking-wide text-tinta-suave uppercase">{t.alMargen}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {r.citas.map((c) => (
              <li key={`${c.doc}-${c.pagina}-${c.fragmento}`}>
                <button type="button" onClick={() => alAbrir({ ...c })} className="group block w-full text-left">
                  <span className="flex items-start gap-3">
                    <span aria-hidden="true" className="shrink-0 border-2 border-lacre px-1.5 py-0.5 font-display text-sm font-semibold text-lacre">
                      {t.pagina} {c.pagina}
                    </span>
                    <span className="text-sm leading-snug font-semibold underline decoration-regla underline-offset-4 group-hover:decoration-lacre">
                      {c.titulo}
                      <span className="sr-only">{t.abrirEn(c.pagina)}</span>
                    </span>
                  </span>
                  <span className="relative mt-2 block text-sm leading-relaxed text-tinta-suave italic">
                    <span aria-hidden="true" className="absolute inset-0 -mx-1 bg-marcador opacity-0 transition-opacity duration-200 group-hover:opacity-60 group-focus-visible:opacity-60" />
                    <span className="relative">«{c.fragmento}»</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </article>
  );
}

function Progreso({ intercambio: x, t }: { intercambio: Intercambio; t: Textos["chat"] }) {
  return (
    <div role="status" className="text-base text-tinta-suave">
      <p className="flex items-center gap-2">
        <span aria-hidden="true" className="h-px w-8 bg-acero motion-safe:animate-pulse" />
        {x.estado === "buscando" ? t.buscando : t.leyendo(x.fuentes.length)}
      </p>
      {x.fuentes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {x.fuentes.map((f) => (
            <li key={`${f.doc}-${f.pagina}-${f.seccion}`}>
              {f.titulo}, {t.pagina} {f.pagina}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
