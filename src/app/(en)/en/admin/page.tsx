import type { Metadata } from "next";
import { metadataPanel, Panel } from "@/components/admin/Panel";

export const metadata: Metadata = metadataPanel("en");

export default async function PanelIngles({ searchParams }: PageProps<"/en/admin">) {
  return <Panel idioma="en" params={await searchParams} />;
}
