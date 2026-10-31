"use client";
// Formularios del panel con estado (errores y confirmaciones accesibles) sobre las server actions.
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrar, subirPdf, type EstadoFormulario } from "@/admin/acciones";
import { TEXTOS, type Idioma } from "@/i18n/textos";

const campo = "mt-1 block min-h-12 w-full border border-borde bg-blanco px-3 py-2 text-base";

function Enviar({ texto, enviando }: { texto: string; enviando: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-12 bg-acero px-5 text-base font-semibold text-blanco transition-colors hover:bg-acero-hondo disabled:opacity-60">
      {pending ? enviando : texto}
    </button>
  );
}

function Mensaje({ estado, id }: { estado: EstadoFormulario; id: string }) {
  if (estado?.error)
    return (
      <p id={id} role="alert" className="flex items-start gap-2 text-base text-error">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 size-4 shrink-0 fill-current">
          <path d="M10 1.5 19 18H1L10 1.5Zm-1 6v5h2v-5H9Zm0 6.5v2h2v-2H9Z" />
        </svg>
        {estado.error}
      </p>
    );
  if (estado?.ok)
    return (
      <p id={id} role="status" className="flex items-start gap-2 text-base">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 size-4 shrink-0 fill-current">
          <path d="M7.5 13.6 3.9 10l-1.4 1.4 5 5 10-10-1.4-1.4-8.6 8.6Z" />
        </svg>
        {estado.ok}
      </p>
    );
  return null;
}

export function FormularioEntrada({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].panel;
  const [estado, accion] = useActionState(entrar, null);
  return (
    <form action={accion} className="flex max-w-sm flex-col gap-4" aria-describedby={estado?.error ? "entrada-mensaje" : undefined}>
      <input type="hidden" name="idioma" value={idioma} />
      <div>
        <label htmlFor="email" className="text-sm font-semibold">
          {t.email}
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={campo} />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-semibold">
          {t.contrasena}
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className={campo} />
      </div>
      <Mensaje estado={estado} id="entrada-mensaje" />
      <div>
        <Enviar texto={t.entrar} enviando={t.verificando} />
      </div>
    </form>
  );
}

export function FormularioSubida({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma].panel;
  const [estado, accion] = useActionState(subirPdf, null);
  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="idioma" value={idioma} />
      <div>
        <label htmlFor="titulo" className="text-sm font-semibold">
          {t.tituloDoc}
        </label>
        <input id="titulo" name="titulo" type="text" required minLength={3} maxLength={120} placeholder={t.ejemploTitulo} className={campo} />
      </div>
      <div>
        <label htmlFor="archivo" className="text-sm font-semibold">
          {t.archivo}
        </label>
        <input
          id="archivo"
          name="archivo"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="mt-1 block w-full text-base file:mr-3 file:min-h-11 file:border file:border-borde file:bg-papel-hondo file:px-3 file:text-sm file:font-semibold"
        />
      </div>
      <Mensaje estado={estado} id="subida-mensaje" />
      <div>
        <Enviar texto={t.subirBoton} enviando={t.subiendo} />
      </div>
    </form>
  );
}
