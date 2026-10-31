import { beforeAll, describe, expect, it } from "vitest";
import { crearManejadorAsk, type EventoAsk } from "@/api/ask";
import { crearArchivosMemoria } from "@/almacen/archivos";
import { crearAlmacenMemoria } from "@/almacen/memoria";
import type { Almacen } from "@/almacen/tipos";
import { crearLimiteIntentos, iniciarSesion, usuarioAdmin } from "@/auth/admin";
import { lineasCitadas } from "@/components/VisorPdf";
import { crearEmbeddingsFalsos } from "@/ia/embeddings";
import type { ModeloJson } from "@/ia/gemini";
import { cargarCorpus, DIR_CORPUS } from "@/ingesta/corpus";
import { ingestar } from "@/ingesta/ingestar";
import { problemaDelPdf, slugDeTitulo } from "@/ingesta/subida";
import { armarUsuario, MENSAJES_SIN_EVIDENCIA, responder, respuestaSchema, type Etapa } from "@/rag/responder";
import path from "node:path";

const embeddings = crearEmbeddingsFalsos();
let almacen: Almacen;

beforeAll(async () => {
  almacen = crearAlmacenMemoria();
  await ingestar(cargarCorpus(), almacen, embeddings);
});

const modeloQueCopia: ModeloJson = {
  nombre: "falso",
  async generar({ usuario }) {
    const texto = usuario.split(/\n\n(?=\[1\] )/)[1].split("\n").slice(1).join(" ");
    return { json: { sin_evidencia: false, respuesta: "Respuesta de prueba.", citas: [{ fuente: 1, fragmento: texto.split(/(?<=\.)\s/)[0] }], confianza: "alta" }, uso: { entrada: 1, salida: 1 } };
  },
};

describe("streaming de /api/ask", () => {
  it("responder avisa las fuentes y la redacción antes de la respuesta", async () => {
    const etapas: Etapa[] = [];
    const { respuesta } = await responder("¿Hasta cuándo puedo cancelar un turno?", {
      almacen,
      embeddings,
      modelo: modeloQueCopia,
      config: { umbral: 0.2 },
      registrar: false,
      alAvanzar: (e) => etapas.push(e),
    });
    expect(etapas.map((e) => e.tipo)).toEqual(["fuentes", "redactando"]);
    expect(etapas[0].tipo === "fuentes" && etapas[0].fuentes.length).toBeGreaterThan(0);
    expect(respuesta.sin_evidencia).toBe(false);
  });

  it("debajo del umbral no avisa fuentes: va directo a la derivación", async () => {
    const etapas: Etapa[] = [];
    const { respuesta } = await responder("pizza grande", { almacen, embeddings, modelo: modeloQueCopia, registrar: false, alAvanzar: (e) => etapas.push(e) });
    expect(etapas).toEqual([]);
    expect(respuesta.sin_evidencia).toBe(true);
  });

  it("con Accept: application/x-ndjson manda una línea por evento y termina con la respuesta validada", async () => {
    const post = crearManejadorAsk({ dependencias: () => ({ almacen, embeddings, modelo: modeloQueCopia }) });
    const r = await post(
      new Request("http://x/api/ask", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ pregunta: "¿Cuál es el CUIT del estudio?" }) }),
    );
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    const eventos = (await r.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as EventoAsk);
    expect(eventos[0]).toEqual({ tipo: "buscando" });
    const ultimo = eventos.at(-1)!;
    expect(ultimo.tipo).toBe("respuesta");
    expect(ultimo.tipo === "respuesta" && ultimo.respuesta.sin_evidencia).toBe(true);
  });

  it("si falla la base, el stream termina con un error sin detalles internos", async () => {
    const post = crearManejadorAsk({
      dependencias: () => ({ almacen: { ...almacen, buscar: async () => Promise.reject(new Error("Supabase 500: detalle interno")) }, embeddings, modelo: modeloQueCopia }),
    });
    const r = await post(new Request("http://x/api/ask", { method: "POST", headers: { Accept: "application/x-ndjson" }, body: JSON.stringify({ pregunta: "¿Hasta cuándo cancelo?" }) }));
    const eventos = (await r.text()).trim().split("\n").map((l) => JSON.parse(l) as EventoAsk);
    expect(eventos.at(-1)).toEqual({ tipo: "error", error: expect.stringContaining("no está disponible") });
    expect(JSON.stringify(eventos)).not.toContain("detalle interno");
  });
});

describe("panel: almacén y archivos", () => {
  it("lista los documentos con sus chunks, muestra los de uno y lo borra con todo", async () => {
    const a = crearAlmacenMemoria();
    await ingestar(cargarCorpus().slice(0, 2), a, embeddings);
    const lista = await a.listarDocumentos();
    expect(lista.map((d) => d.slug)).toEqual(["01-calendario-vencimientos-internos", "02-checklist-alta-cliente"]);
    expect(lista.every((d) => d.chunks > 0 && d.paginas > 0)).toBe(true);
    const chunks = await a.chunksDe("01-calendario-vencimientos-internos");
    expect(chunks).toHaveLength(lista[0].chunks);
    expect(chunks.map((c) => c.pagina)).toEqual([...chunks.map((c) => c.pagina)].sort((x, y) => x - y));
    await a.borrarDocumento("01-calendario-vencimientos-internos");
    expect((await a.listarDocumentos()).map((d) => d.slug)).toEqual(["02-checklist-alta-cliente"]);
    expect(await a.chunksDe("01-calendario-vencimientos-internos")).toEqual([]);
  });

  it("los archivos en memoria leen el corpus de la carpeta y no salen de ella", async () => {
    const f = crearArchivosMemoria(path.join(DIR_CORPUS, "pdf"));
    expect((await f.bajar("04-politica-turnos"))?.length).toBeGreaterThan(1000);
    expect(await f.bajar("../../package")).toBeNull();
    await f.subir("subido-x", new Uint8Array([37, 80, 68, 70]));
    expect(await f.bajar("subido-x")).toEqual(new Uint8Array([37, 80, 68, 70]));
    await f.borrar("subido-x");
    expect(await f.bajar("subido-x")).toBeNull();
  });
});

describe("panel: subida de PDFs", () => {
  it("el slug sale del título, sin tildes ni símbolos y con el prefijo de subido", () => {
    expect(slugDeTitulo("Política de mascotas (e2e)")).toBe("subido-politica-de-mascotas-e2e");
    expect(slugDeTitulo("¡¡¡")).toBe("subido-documento");
    expect(slugDeTitulo("a".repeat(200)).length).toBeLessThanOrEqual(7 + 60);
  });

  it("acepta un PDF y rechaza vacíos, grandes y lo que no empieza con %PDF-", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    expect(problemaDelPdf({ size: 100, type: "application/pdf" }, pdf)).toBeNull();
    expect(problemaDelPdf({ size: 0, type: "application/pdf" }, pdf)).toBe("vacio");
    expect(problemaDelPdf({ size: 6 * 1024 * 1024, type: "application/pdf" }, pdf)).toBe("grande");
    expect(problemaDelPdf({ size: 100, type: "application/pdf" }, new TextEncoder().encode("<html>"))).toBe("no_pdf");
    expect(problemaDelPdf({ size: 100, type: "text/html" }, pdf)).toBe("no_pdf");
  });
});

describe("panel: sesión con Supabase Auth", () => {
  const usuario = (rol?: string) => Response.json({ email: "admin-demo@example.com", app_metadata: rol ? { rol, provider: "email" } : { provider: "email" } });
  const fetchFalso = (token: number, rol?: string) =>
    (async (url: string | URL | Request) => (String(url).includes("/token") ? (token === 200 ? Response.json({ access_token: "a".repeat(40), expires_in: 3600 }) : new Response("{}", { status: token })) : usuario(rol))) as typeof fetch;
  const c = (f: typeof fetch) => ({ url: "https://x.supabase.co", clave: "secreta", fetch: f });

  it("entra un administrador", async () => {
    expect(await iniciarSesion(c(fetchFalso(200, "admin")), "admin-demo@example.com", "una-clave-larga")).toEqual({ token: "a".repeat(40), segundos: 3600 });
  });

  it("un usuario sin rol admin no entra aunque la contraseña sea correcta", async () => {
    expect(await iniciarSesion(c(fetchFalso(200)), "otro@example.com", "una-clave-larga")).toBeNull();
    expect(await usuarioAdmin(c(fetchFalso(200, "lector")), "token")).toBeNull();
  });

  it("contraseña incorrecta → null; Supabase caído → error (el panel avisa que no pudo verificar)", async () => {
    expect(await iniciarSesion(c(fetchFalso(400)), "admin-demo@example.com", "incorrecta")).toBeNull();
    await expect(iniciarSesion(c(fetchFalso(503)), "admin-demo@example.com", "una-clave-larga")).rejects.toThrow("503");
  });

  it("sin token no hay sesión", async () => {
    expect(await usuarioAdmin(c(fetchFalso(200, "admin")), undefined)).toBeNull();
  });

  it("limita los intentos de entrada por IP", () => {
    let t = 0;
    const permitir = crearLimiteIntentos(3, 60_000, () => t);
    expect([1, 2, 3, 4].map(() => permitir("1.1.1.1"))).toEqual([true, true, true, false]);
    expect(permitir("2.2.2.2")).toBe(true);
    t = 61_000;
    expect(permitir("1.1.1.1")).toBe(true);
  });
});

describe("visor: resaltado de la cita", () => {
  it("marca las líneas de la página que forman parte de la cita, ignorando tildes y las muy cortas", () => {
    const lineas = ["Recepción mensual de comprobantes", "El estudio recibe los comprobantes de ventas y compras del mes anterior", "hasta el día 5 de cada mes.", "de la", "Liquidaciones mensuales"];
    const cita = "El estudio recibe los comprobantes de ventas y compras del mes anterior hasta el dia 5 de cada mes.";
    expect(lineasCitadas(lineas, cita)).toEqual([false, true, true, false, false]);
  });
});

describe("versión en inglés", () => {
  it("en español el pedido al modelo no cambia; en inglés pide responder en inglés con citas textuales en español", () => {
    expect(armarUsuario("¿Hola?", [])).toBe(armarUsuario("¿Hola?", [], "es"));
    expect(armarUsuario("¿Hola?", [])).not.toContain("Idioma de la respuesta");
    expect(armarUsuario("Hi?", [], "en")).toContain("Idioma de la respuesta: inglés");
  });

  it("sin evidencia en inglés devuelve el mensaje fijo en inglés, y el schema lo acepta", async () => {
    const { respuesta } = await responder("pizza grande", { almacen, embeddings, modelo: modeloQueCopia, registrar: false, idioma: "en" });
    expect(respuesta.respuesta).toBe(MENSAJES_SIN_EVIDENCIA.en);
    expect(respuestaSchema.safeParse(respuesta).success).toBe(true);
    expect(respuestaSchema.safeParse({ ...respuesta, respuesta: "otro texto" }).success).toBe(false);
  });

  it("/api/ask acepta idioma y rechaza uno que no existe", async () => {
    const post = crearManejadorAsk({ dependencias: () => ({ almacen, embeddings, modelo: modeloQueCopia }) });
    const pedir = (idioma: string) => post(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify({ pregunta: "pizza grande", idioma }) }));
    expect(((await (await pedir("en")).json()) as { respuesta: string }).respuesta).toBe(MENSAJES_SIN_EVIDENCIA.en);
    expect((await pedir("fr")).status).toBe(400);
  });
});
