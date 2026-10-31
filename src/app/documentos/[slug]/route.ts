// GET /documentos/<slug>: el PDF original, desde el bucket privado (el servidor lo lee con la clave secreta).
// Son los documentos que el chat cita, así que se pueden ver sin sesión.
import { archivosReales } from "@/rag/dependencias";

export async function GET(_req: Request, ctx: RouteContext<"/documentos/[slug]">) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await archivosReales().bajar(slug);
    if (!datos) return new Response("No encontrado", { status: 404 });
    return new Response(datos.slice().buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}.pdf"`,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("documentos:", e instanceof Error ? e.name : "error");
    return new Response("No disponible", { status: 503 });
  }
}
