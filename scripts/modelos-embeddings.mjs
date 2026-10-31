// Lista los modelos de embeddings que la clave de Gemini puede usar (sin mostrar la clave).
// Uso: npm run modelos
try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: la API responde 403 y se avisa abajo
}
const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" } });
const datos = await r.json();
for (const m of datos.models ?? []) if (m.supportedGenerationMethods?.some((x) => /embed/i.test(x))) console.log(m.name, m.supportedGenerationMethods.join(","));
if (!r.ok) console.log("HTTP", r.status, "(¿falta GEMINI_API_KEY? npm run check-env)");
