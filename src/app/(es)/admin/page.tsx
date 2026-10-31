import type { Metadata } from "next";
import { metadataPanel, Panel } from "@/components/admin/Panel";

export const metadata: Metadata = metadataPanel("es");

export default async function PanelEspanol({ searchParams }: PageProps<"/admin">) {
  return <Panel idioma="es" params={await searchParams} />;
}
