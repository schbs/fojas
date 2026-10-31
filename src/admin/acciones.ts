"use server";
// Acciones del panel. Todas, salvo entrar, verifican la sesión de administrador contra Supabase Auth. Cada formulario
// manda su idioma en un campo oculto: los mensajes y las redirecciones salen en ese idioma.
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDeEncabezados } from "@/api/ask";
import { COOKIE_SESION, credencialesSchema, crearLimiteIntentos, iniciarSesion } from "@/auth/admin";
import { adminActual, configAuth } from "@/auth/sesion";
import { idiomaDe, TEXTOS } from "@/i18n/textos";
import { ingestar } from "@/ingesta/ingestar";
import { PREFIJO_SUBIDO, problemaDelPdf, slugDeTitulo, tituloSchema } from "@/ingesta/subida";
import { archivosReales, dependenciasReales } from "@/rag/dependencias";

export type EstadoFormulario = { error?: string; ok?: string } | null;

const limiteEntrada = crearLimiteIntentos(5, 60_000);
const panelDe = (datos: FormData) => `${TEXTOS[idiomaDe(datos.get("idioma"))].base}/admin`;

export async function entrar(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const t = TEXTOS[idiomaDe(datos.get("idioma"))].acciones;
  if (!limiteEntrada(ipDeEncabezados(await headers()))) return { error: t.intentos };
  const c = credencialesSchema.safeParse({ email: datos.get("email"), password: datos.get("password") });
  if (!c.success) return { error: c.error.issues[0]?.path[0] === "email" ? t.email : t.contrasena };
  let sesion: Awaited<ReturnType<typeof iniciarSesion>>;
  try {
    sesion = await iniciarSesion(configAuth(), c.data.email, c.data.password);
  } catch (e) {
    console.error("entrar:", e instanceof Error ? e.name : "error");
    return { error: t.noVerifica };
  }
  if (!sesion) return { error: t.incorrectos };
  // path "/": la misma sesión sirve para /admin y /en/admin.
  (await cookies()).set(COOKIE_SESION, sesion.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sesion.segundos,
  });
  redirect(panelDe(datos));
}

export async function salir(datos: FormData) {
  const almacen = await cookies();
  const token = almacen.get(COOKIE_SESION)?.value;
  almacen.delete({ name: COOKIE_SESION, path: "/" });
  if (token) {
    const c = configAuth();
    // Cierra la sesión también en Supabase; si falla, la cookie ya no está y el token vence solo.
    await fetch(`${c.url.replace(/\/$/, "")}/auth/v1/logout`, { method: "POST", headers: { apikey: c.clave, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
  redirect(panelDe(datos));
}

async function exigirAdmin(datos: FormData) {
  if (!(await adminActual())) redirect(panelDe(datos));
}

export async function subirPdf(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  await exigirAdmin(datos);
  const t = TEXTOS[idiomaDe(datos.get("idioma"))].acciones;
  const titulo = tituloSchema.safeParse(datos.get("titulo"));
  if (!titulo.success) return { error: t.tituloInvalido };
  const archivo = datos.get("archivo");
  if (!(archivo instanceof File)) return { error: t.sinArchivo };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const problema = problemaDelPdf(archivo, bytes);
  if (problema) return { error: t.pdf[problema] };

  const slug = slugDeTitulo(titulo.data);
  const { almacen, embeddings } = dependenciasReales();
  const archivos = archivosReales();
  if (await almacen.documento(slug)) return { error: t.repetido };
  try {
    await archivos.subir(slug, bytes);
    const r = await ingestar([{ slug, titulo: titulo.data, datos: bytes }], almacen, embeddings);
    const doc = await almacen.documento(slug);
    revalidatePath(panelDe(datos));
    return { ok: t.listo(titulo.data, doc?.paginas ?? "?", r.chunksNuevos) };
  } catch (e) {
    // Si la lectura o los embeddings fallan, no queda un documento a medias.
    console.error("subir:", e instanceof Error ? e.message.slice(0, 200) : "error");
    await almacen.borrarDocumento(slug).catch(() => undefined);
    await archivos.borrar(slug).catch(() => undefined);
    return { error: t.noIndexa };
  }
}

const slugValido = (v: FormDataEntryValue | null) => (typeof v === "string" && /^[a-z0-9-]{1,80}$/.test(v) ? v : null);

export async function reingestar(datos: FormData) {
  await exigirAdmin(datos);
  const panel = panelDe(datos);
  const slug = slugValido(datos.get("slug"));
  if (!slug) redirect(panel);
  const { almacen, embeddings } = dependenciasReales();
  const doc = await almacen.documento(slug);
  const pdf = doc ? await archivosReales().bajar(slug) : null;
  if (!doc || !pdf) redirect(`${panel}?resultado=sin-pdf&doc=${slug}`);
  // Marca el documento como cambiado para que la ingesta lo vuelva a leer; solo pide embeddings de lo que cambió.
  await almacen.guardarDocumento({ ...doc, hashArchivo: "reingesta" });
  const r = await ingestar([{ slug, titulo: doc.titulo, datos: pdf }], almacen, embeddings);
  revalidatePath(panel);
  redirect(`${panel}?resultado=reingestado&doc=${slug}&nuevos=${r.chunksNuevos}&borrados=${r.chunksBorrados}`);
}

export async function borrarDocumento(datos: FormData) {
  await exigirAdmin(datos);
  const panel = panelDe(datos);
  const slug = slugValido(datos.get("slug"));
  // Solo los documentos subidos desde el panel: el corpus del estudio no se borra desde acá.
  if (!slug?.startsWith(PREFIJO_SUBIDO)) redirect(panel);
  await dependenciasReales().almacen.borrarDocumento(slug);
  await archivosReales().borrar(slug);
  revalidatePath(panel);
  redirect(`${panel}?resultado=borrado&doc=${slug}`);
}
