// Encabezado y pie comunes al chat y al panel: membrete del estudio, aviso de contenido ficticio, idioma y autoría.
import Link from "next/link";
import { TEXTOS, type Idioma } from "@/i18n/textos";

const enlace = "inline-flex min-h-11 items-center underline-offset-4 hover:underline aria-[current=page]:font-semibold aria-[current=page]:underline";

export function Encabezado({ idioma, actual }: { idioma: Idioma; actual: "chat" | "admin" }) {
  const { base, marco: t } = TEXTOS[idioma];
  const otro = t.otroIdioma;
  return (
    <header className="border-b border-regla">
      <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href={base || "/"} className="font-display text-lg font-semibold tracking-tight sm:text-xl">
          Estudio Ruca &amp; Asociados
        </Link>
        <nav aria-label={t.secciones}>
          <ul className="flex gap-4 text-sm sm:gap-5">
            <li>
              <Link href={base || "/"} aria-current={actual === "chat" ? "page" : undefined} className={enlace}>
                {t.consultas}
              </Link>
            </li>
            <li>
              <Link href={`${base}/admin`} aria-current={actual === "admin" ? "page" : undefined} className={enlace}>
                {t.panel}
              </Link>
            </li>
            <li>
              <Link href={actual === "admin" ? `${otro.href === "/" ? "" : otro.href}/admin` : otro.href} lang={otro.lang} hrefLang={otro.lang} className={enlace}>
                {otro.texto}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-regla bg-papel-hondo">
        <span className="mx-auto flex max-w-5xl items-start gap-2 px-4 py-2 text-sm text-tinta-suave sm:px-6">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 fill-current">
            <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 3.75a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM11.25 14.5h-2.5v-1h.5V10h-.5V9h2v4.5h.5v1Z" />
          </svg>
          <span>
            <strong className="font-semibold text-tinta">{t.avisoFuerte}</strong> {t.aviso}
          </span>
        </span>
      </p>
    </header>
  );
}

export function Pie({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].marco;
  return (
    <footer className="border-t border-regla">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 text-sm text-tinta-suave sm:flex-row sm:justify-between sm:px-6">
        <p>{t.demo}</p>
        <p>{t.autor}</p>
      </div>
    </footer>
  );
}
