// Panel del estudio (Supabase Auth): subir un PDF, ver sus chunks, reingestar y revisar las preguntas sin evidencia.
// Lo usan /admin y /en/admin.
import type { Metadata } from "next";
import Link from "next/link";
import { borrarDocumento, reingestar, salir } from "@/admin/acciones";
import { adminActual } from "@/auth/sesion";
import { FormularioEntrada, FormularioSubida } from "@/components/admin/Formularios";
import { Encabezado, Pie } from "@/components/Marco";
import { TEXTOS, type Idioma, type Textos } from "@/i18n/textos";
import { PREFIJO_SUBIDO } from "@/ingesta/subida";
import { dependenciasReales } from "@/rag/dependencias";

type Params = Record<string, string | string[] | undefined>;

export function metadataPanel(idioma: Idioma): Metadata {
  const t = TEXTOS[idioma].meta;
  return { title: t.tituloPanel, description: t.descripcionPanel };
}

export async function Panel({ idioma, params }: { idioma: Idioma; params: Params }) {
  const email = await adminActual();
  return (
    <>
      <Encabezado idioma={idioma} actual="admin" />
      <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">{email ? <Contenido idioma={idioma} email={email} params={params} /> : <Entrada idioma={idioma} />}</main>
      <Pie idioma={idioma} />
    </>
  );
}

function Entrada({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].panel;
  return (
    <div className="grid gap-8 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="max-w-xl">
        <h1 className="font-display text-3xl leading-tight font-medium sm:text-4xl">{t.titulo}</h1>
        <p className="mt-3 text-base leading-relaxed text-tinta-suave">{t.intro}</p>
      </div>
      <section aria-labelledby="titulo-entrada" className="border-t border-tinta pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        <h2 id="titulo-entrada" className="font-display text-xl font-medium">
          {t.entrar}
        </h2>
        <div className="mt-4">
          <FormularioEntrada idioma={idioma} />
        </div>
      </section>
    </div>
  );
}

async function Contenido({ idioma, email, params }: { idioma: Idioma; email: string; params: Params }) {
  const { base, panel: t } = TEXTOS[idioma];
  const { almacen } = dependenciasReales();
  const verDoc = typeof params.doc === "string" ? params.doc : undefined;
  const [documentos, sinEvidencia] = await Promise.all([almacen.listarDocumentos(), almacen.sinEvidencia(20)]);
  const elegido = documentos.find((d) => d.slug === verDoc);
  const chunks = elegido ? await almacen.chunksDe(elegido.slug) : [];
  const aviso = resultado(params, documentos, t);
  const fecha = new Intl.DateTimeFormat(TEXTOS[idioma].lang, { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });
  const idiomaOculto = <input type="hidden" name="idioma" value={idioma} />;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 sm:pt-12">
        <div>
          <h1 className="font-display text-3xl leading-tight font-medium sm:text-4xl">{t.titulo}</h1>
          <p className="mt-2 text-sm text-tinta-suave">{t.sesionDe(email)}</p>
        </div>
        <form action={salir}>
          {idiomaOculto}
          <button type="submit" className="min-h-11 border border-borde px-4 text-sm font-semibold hover:bg-acero-claro">
            {t.salir}
          </button>
        </form>
      </div>

      {aviso && (
        <p role="status" className="mt-6 border-l-2 border-acero bg-acero-claro px-4 py-3 text-base">
          {aviso}
        </p>
      )}

      <section aria-labelledby="titulo-subir" className="mt-10 border-t border-tinta pt-6">
        <h2 id="titulo-subir" className="font-display text-2xl font-medium">
          {t.subir}
        </h2>
        <p className="mt-1 max-w-prose text-base text-tinta-suave">{t.subirIntro}</p>
        <div className="mt-4 max-w-xl">
          <FormularioSubida idioma={idioma} />
        </div>
      </section>

      <section aria-labelledby="titulo-documentos" className="mt-12 border-t border-tinta pt-6">
        <h2 id="titulo-documentos" className="font-display text-2xl font-medium">
          {t.documentos(documentos.length)}
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <caption className="sr-only">{t.caption}</caption>
            <thead>
              <tr className="border-b border-tinta">
                {t.columnas.map((c, i) => (
                  <th key={c} scope="col" className={`py-2 font-semibold ${i < 3 ? "pr-4" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => {
                const abierto = d.slug === verDoc;
                return (
                  <tr key={d.slug} className="border-b border-regla align-top">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      <span className="block text-base font-semibold">{d.titulo}</span>
                      <span className="text-tinta-suave">{d.slug}</span>
                    </th>
                    <td className="py-2 pr-4 tabular-nums">{d.paginas}</td>
                    <td className="py-2 pr-4 tabular-nums">{d.chunks}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={abierto ? `${base}/admin#titulo-documentos` : `${base}/admin?doc=${d.slug}#fragmentos`}
                          className="inline-flex min-h-11 items-center border border-borde px-3 hover:bg-acero-claro"
                          aria-label={abierto ? t.ocultarDe(d.titulo) : t.verDe(d.titulo)}
                        >
                          {abierto ? t.ocultar : t.ver}
                        </Link>
                        <form action={reingestar}>
                          {idiomaOculto}
                          <input type="hidden" name="slug" value={d.slug} />
                          <button type="submit" className="min-h-11 border border-borde px-3 hover:bg-acero-claro" aria-label={t.reingestarDe(d.titulo)}>
                            {t.reingestar}
                          </button>
                        </form>
                        {d.slug.startsWith(PREFIJO_SUBIDO) && (
                          <form action={borrarDocumento}>
                            {idiomaOculto}
                            <input type="hidden" name="slug" value={d.slug} />
                            <button type="submit" className="min-h-11 border border-error px-3 text-error hover:bg-lacre-claro" aria-label={t.borrarDe(d.titulo)}>
                              {t.borrar}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {elegido && (
          <div id="fragmentos" className="mt-6 scroll-mt-6">
            <h3 className="font-display text-xl font-medium">{t.fragmentosDe(elegido.titulo, chunks.length)}</h3>
            <ol className="mt-3 flex flex-col gap-3">
              {chunks.map((c, i) => (
                <li key={i} className="border-l-2 border-regla pl-4">
                  <p className="text-sm font-semibold text-tinta-suave">
                    {t.pagina(c.pagina)} · {c.seccion || t.sinSeccion}
                  </p>
                  <p className="mt-1 max-w-prose text-sm leading-relaxed">{textoDelFragmento(c.contenido, c.seccion)}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section aria-labelledby="titulo-sin-evidencia" className="mt-12 border-t border-tinta pt-6">
        <h2 id="titulo-sin-evidencia" className="font-display text-2xl font-medium">
          {t.sinRespuesta}
        </h2>
        <p className="mt-1 max-w-prose text-base text-tinta-suave">{t.sinRespuestaIntro}</p>
        {sinEvidencia.length === 0 ? (
          <p className="mt-4 text-base">{t.sinRespuestaVacia}</p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {sinEvidencia.map((s, i) => (
              <li key={i} className="border-b border-regla py-3">
                <p className="text-base">{s.pregunta}</p>
                <p className="mt-1 text-sm text-tinta-suave">
                  {s.creadoEn ? fecha.format(new Date(s.creadoEn)) : ""} · {t.motivos[s.motivo]}
                  {s.mejorSimilitud !== null ? t.similitud(s.mejorSimilitud) : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** El chunk guarda el título de su sección y los saltos de línea del PDF: para leerlo se sacan los dos. */
function textoDelFragmento(contenido: string, seccion: string): string {
  const [primera, ...resto] = contenido.split("\n");
  return (primera.trim() === seccion.trim() && resto.length ? resto : [primera, ...resto]).join(" ").replace(/\s+/g, " ").trim();
}

function resultado(params: Params, documentos: { slug: string; titulo: string }[], t: Textos["panel"]): string | null {
  // Solo se nombran documentos que existen o slugs válidos (el enlace no puede inyectar texto en el aviso).
  const slug = typeof params.doc === "string" && /^[a-z0-9-]{1,80}$/.test(params.doc) ? params.doc : "";
  const titulo = documentos.find((d) => d.slug === slug)?.titulo ?? slug;
  const n = (v: unknown) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? v : "0");
  switch (params.resultado) {
    case "reingestado":
      return t.reingestado(titulo, n(params.nuevos), n(params.borrados));
    case "borrado":
      return t.borrado(titulo);
    case "sin-pdf":
      return t.sinPdf(titulo);
    default:
      return null;
  }
}
