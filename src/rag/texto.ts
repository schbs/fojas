// Normalización de texto en español para comparar palabras (búsqueda en memoria, reranking y validación de citas).

export const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const VACIAS = new Set(
  "que los las del por para con una uno unos unas son como mas pero sus hay esta este esto cada desde hasta sin sobre cuando donde quien cual muy tambien puedo tengo pasa hace eso esa ese esos esas".split(" "),
);

/** Raíz sencilla: saca plurales y algunas terminaciones, para que "comprobantes" y "comprobante" coincidan. */
export const raiz = (p: string) => p.replace(/(es|s)$/, "").slice(0, 7);

/** Palabras con contenido (3 letras o más, sin las vacías), ya reducidas a su raíz. */
export const terminos = (texto: string): string[] =>
  (sinTildes(texto).match(/[a-z0-9]+/g) ?? []).filter((p) => p.length >= 3 && !VACIAS.has(p)).map(raiz);

/** Para comparar una cita con su fuente: minúsculas, sin tildes, comillas y guiones unificados, espacios simples. */
export const paraComparar = (s: string) =>
  sinTildes(s)
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
