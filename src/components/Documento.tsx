// <html> de cada idioma: un layout raíz por grupo de rutas ((es) y (en)) para que lang sea el correcto.
import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { TEXTOS, type Idioma } from "@/i18n/textos";
import "@/app/globals.css";

const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });

export function metadataDe(idioma: Idioma): Metadata {
  const t = TEXTOS[idioma].meta;
  // Sin hreflang hasta tener la URL pública: Lighthouse pide direcciones absolutas.
  return { title: t.titulo, description: t.descripcion };
}

export function Documento({ idioma, children }: { idioma: Idioma; children: React.ReactNode }) {
  return (
    <html lang={TEXTOS[idioma].lang} className={`${newsreader.variable} ${publicSans.variable}`}>
      <body className="min-h-dvh bg-papel text-tinta antialiased">{children}</body>
    </html>
  );
}
