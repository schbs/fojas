import type { Metadata } from "next";
import { Documento, metadataDe } from "@/components/Documento";

export const metadata: Metadata = metadataDe("en");

export default function LayoutIngles({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Documento idioma="en">{children}</Documento>;
}
