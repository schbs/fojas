// Sesión del panel con Supabase Auth (email y contraseña), todo del lado del servidor: el navegador solo guarda el
// token de acceso en una cookie httpOnly. Entra únicamente un usuario con app_metadata.rol = "admin", que solo puede
// fijar la clave secreta (scripts/crear-admin-demo.ts); registrarse por la API pública no alcanza para entrar.
import { z } from "zod";

export const COOKIE_SESION = "fojas_admin";

export interface ConfigAuth {
  url: string;
  clave: string;
  fetch?: typeof fetch;
}

export const credencialesSchema = z.object({
  email: z.email("Escribí un email válido.").max(200),
  password: z.string().min(8, "La contraseña tiene al menos 8 caracteres.").max(200),
});

const tokenSchema = z.object({ access_token: z.string().min(20), expires_in: z.number().int().positive() });
const usuarioSchema = z.object({ email: z.string(), app_metadata: z.object({ rol: z.string().optional() }).loose() });

const auth = (c: ConfigAuth) => `${c.url.replace(/\/$/, "")}/auth/v1`;

/** Devuelve el token si el email y la contraseña son de un administrador; si no, null (sin decir qué falló). */
export async function iniciarSesion(c: ConfigAuth, email: string, password: string): Promise<{ token: string; segundos: number } | null> {
  const pedir = c.fetch ?? fetch;
  const r = await pedir(`${auth(c)}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: c.clave, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 400 || r.status === 401 || r.status === 422) return null;
  if (!r.ok) throw new Error(`Auth token → ${r.status}`);
  const t = tokenSchema.parse(await r.json());
  return (await usuarioAdmin(c, t.access_token)) ? { token: t.access_token, segundos: t.expires_in } : null;
}

/** El email del administrador dueño del token, o null si el token venció, es inválido o no es de un administrador. */
export async function usuarioAdmin(c: ConfigAuth, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const pedir = c.fetch ?? fetch;
  const r = await pedir(`${auth(c)}/user`, { headers: { apikey: c.clave, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const u = usuarioSchema.safeParse(await r.json());
  return u.success && u.data.app_metadata.rol === "admin" ? u.data.email : null;
}

/** Límite de intentos de entrada por IP (en memoria de la instancia, como /api/ask). */
export function crearLimiteIntentos(maximo = 5, ventanaMs = 60_000, ahora: () => number = Date.now) {
  const intentos = new Map<string, number[]>();
  return (ip: string): boolean => {
    const t = ahora();
    const recientes = (intentos.get(ip) ?? []).filter((x) => t - x < ventanaMs);
    if (recientes.length >= maximo) return false;
    intentos.set(ip, [...recientes, t]);
    if (intentos.size > 1000) for (const [k, v] of intentos) if (v.every((x) => t - x >= ventanaMs)) intentos.delete(k);
    return true;
  };
}
