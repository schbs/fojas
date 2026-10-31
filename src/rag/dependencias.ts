// Arma las dependencias reales del asistente a partir de las variables de entorno (solo del lado del servidor).
import { crearArchivosSupabase, type Archivos } from "@/almacen/archivos";
import { crearAlmacenSupabase } from "@/almacen/supabase";
import type { Almacen } from "@/almacen/tipos";
import { crearEmbeddingsGemini, type Embeddings } from "@/ia/embeddings";
import { crearModeloGemini, type ModeloJson } from "@/ia/gemini";

export interface Dependencias {
  almacen: Almacen;
  embeddings: Embeddings;
  modelo: ModeloJson;
}

export class FaltaConfiguracion extends Error {}

function exigir(env: NodeJS.ProcessEnv, nombres: string[]) {
  const faltan = nombres.filter((n) => !env[n]);
  if (faltan.length) throw new FaltaConfiguracion(`Faltan variables: ${faltan.join(", ")}`);
}

export function dependenciasReales(env: NodeJS.ProcessEnv = process.env): Dependencias {
  exigir(env, ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  return {
    almacen: crearAlmacenSupabase({ url: env.SUPABASE_URL!, clave: env.SUPABASE_SECRET_KEY! }),
    embeddings: crearEmbeddingsGemini({ apiKey: env.GEMINI_API_KEY! }),
    modelo: crearModeloGemini({ apiKey: env.GEMINI_API_KEY!, modelo: env.GEMINI_MODEL || undefined }),
  };
}

/** Los PDFs originales (visor y panel). */
export function archivosReales(env: NodeJS.ProcessEnv = process.env): Archivos {
  exigir(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  return crearArchivosSupabase({ url: env.SUPABASE_URL!, clave: env.SUPABASE_SECRET_KEY! });
}
