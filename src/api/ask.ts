// POST /api/ask: valida la pregunta, limita pedidos por IP y responde con el JSON de responder() (siempre validado).
// La lógica vive acá (testeable con dependencias falsas); src/app/api/ask/route.ts solo la conecta.
import { z } from "zod";
import type { Dependencias } from "@/rag/dependencias";
import { responder, type Etapa, type Idioma, type Respuesta } from "@/rag/responder";

export const preguntaSchema = z.object({
  pregunta: z.string().trim().min(3, "La pregunta es muy corta.").max(500, "La pregunta es muy larga (máximo 500 caracteres)."),
  // Idioma de la respuesta (la interfaz en inglés manda "en"); las citas quedan en el idioma del documento.
  idioma: z.enum(["es", "en"]).default("es"),
});

/**
 * IP del cliente desde una fuente confiable: x-real-ip la pone Vercel (el cliente no la puede fijar). Si no está, la
 * última entrada de x-forwarded-for, que agrega el proxy propio; la primera la puede inventar el cliente.
 */
export function ipCliente(req: Request): string {
  return ipDeEncabezados(req.headers);
}

/** Lo mismo desde los encabezados (las server actions del panel no reciben el Request). */
export function ipDeEncabezados(h: Headers): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean).at(-1) || "local";
}

export function crearManejadorAsk(opciones: { dependencias: () => Dependencias; limitePorMinuto?: number; limiteGlobalPorMinuto?: number; ahora?: () => number }) {
  const limite = opciones.limitePorMinuto ?? 10;
  // Tope total por instancia: aunque alguien rote IPs, no agota el cupo de Gemini ni llena la tabla unanswered.
  const limiteGlobal = opciones.limiteGlobalPorMinuto ?? 60;
  const ahora = opciones.ahora ?? Date.now;
  // Límites en memoria de la instancia: alcanza para la demo (en producción, un KV compartido con vencimiento).
  const pedidos = new Map<string, number[]>();
  let global: number[] = [];

  return async function POST(req: Request): Promise<Response> {
    const t = ahora();
    const ip = ipCliente(req);
    const demasiadas = () => Response.json({ error: "Demasiadas preguntas seguidas. Probá en un minuto." }, { status: 429 });
    // Primero el límite por IP (cuenta todo, también los pedidos inválidos).
    const recientes = (pedidos.get(ip) ?? []).filter((x) => t - x < 60_000);
    if (recientes.length >= limite) return demasiadas();
    pedidos.set(ip, [...recientes, t]);
    // Las IPs que no preguntaron en el último minuto se borran: el mapa no crece sin límite.
    if (pedidos.size > 1000) for (const [k, v] of pedidos) if (v.every((x) => t - x >= 60_000)) pedidos.delete(k);

    const cuerpo = preguntaSchema.safeParse(await req.json().catch(() => null));
    if (!cuerpo.success) return Response.json({ error: cuerpo.error.issues[0]?.message ?? "Pedido inválido." }, { status: 400 });

    // El tope global cuenta solo preguntas válidas (las que gastan embeddings y Gemini): la basura no lo agota.
    global = global.filter((x) => t - x < 60_000);
    if (global.length >= limiteGlobal) return demasiadas();
    global.push(t);

    // Con Accept: application/x-ndjson (el chat) se manda cada etapa a medida que pasa; si no, un solo JSON.
    if (req.headers.get("accept")?.includes("application/x-ndjson")) return enStreaming(cuerpo.data.pregunta, cuerpo.data.idioma, opciones.dependencias);

    try {
      const { respuesta } = await responder(cuerpo.data.pregunta, { ...opciones.dependencias(), idioma: cuerpo.data.idioma });
      return Response.json(respuesta);
    } catch (e) {
      return Response.json({ error: noDisponible(e) }, { status: 503 });
    }
  };
}

/** Sin embeddings o sin base no se puede buscar evidencia: se informa sin detalles internos. */
function noDisponible(e: unknown): string {
  console.error("ask:", e instanceof Error ? e.name : "error");
  return "El asistente no está disponible ahora. Probá de nuevo en unos minutos.";
}

/** Una línea JSON por evento: buscando → fuentes → redactando → respuesta (o error). */
export type EventoAsk =
  | { tipo: "buscando" }
  | Etapa
  | { tipo: "respuesta"; respuesta: Respuesta }
  | { tipo: "error"; error: string };

function enStreaming(pregunta: string, idioma: Idioma, dependencias: () => Dependencias): Response {
  const codificar = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(control) {
      const enviar = (e: EventoAsk) => control.enqueue(codificar.encode(`${JSON.stringify(e)}\n`));
      enviar({ tipo: "buscando" });
      try {
        const { respuesta } = await responder(pregunta, { ...dependencias(), idioma, alAvanzar: enviar });
        enviar({ tipo: "respuesta", respuesta });
      } catch (e) {
        enviar({ tipo: "error", error: noDisponible(e) });
      }
      control.close();
    },
  });
  return new Response(cuerpo, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
