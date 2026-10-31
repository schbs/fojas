// Sesión del panel en el servidor: lee la cookie y pregunta a Supabase Auth si el token es de un administrador.
import "server-only";
import { cookies } from "next/headers";
import { FaltaConfiguracion } from "@/rag/dependencias";
import { COOKIE_SESION, usuarioAdmin, type ConfigAuth } from "./admin";

export function configAuth(env: NodeJS.ProcessEnv = process.env): ConfigAuth {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new FaltaConfiguracion("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY");
  return { url: env.SUPABASE_URL, clave: env.SUPABASE_SECRET_KEY };
}

/** Email del administrador con sesión, o null. */
export async function adminActual(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  return token ? usuarioAdmin(configAuth(), token).catch(() => null) : null;
}
