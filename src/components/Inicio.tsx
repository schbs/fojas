import { Chat } from "@/components/Chat";
import { Encabezado, Pie } from "@/components/Marco";
import { TEXTOS, type Idioma } from "@/i18n/textos";

export function Inicio({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].inicio;
  return (
    <>
      <Encabezado idioma={idioma} actual="chat" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="max-w-2xl pt-8 pb-2 sm:pt-12">
          <h1 className="font-display text-3xl leading-tight font-medium text-balance sm:text-4xl">{t.titulo}</h1>
          <p className="mt-3 text-base leading-relaxed text-tinta-suave">{t.intro}</p>
        </div>
        <Chat idioma={idioma} />
      </main>
      <Pie idioma={idioma} />
    </>
  );
}
