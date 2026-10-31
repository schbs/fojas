// Después de los e2e (y antes, por si una corrida quedó cortada): borra el documento de prueba con sus chunks y su PDF,
// y las consultas marcadas [e2e] de la tabla unanswered. No toca nada más.
import { MARCA, SLUG_PRUEBA } from "./ayudas";

export default async function limpiar() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    return;
  }
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) return;
  const headers = { apikey: clave, Authorization: `Bearer ${clave}` };
  const pedidos = [
    fetch(`${url}/rest/v1/documents?slug=eq.${SLUG_PRUEBA}`, { method: "DELETE", headers }),
    fetch(`${url}/storage/v1/object/documentos/${SLUG_PRUEBA}.pdf`, { method: "DELETE", headers }),
    fetch(`${url}/rest/v1/unanswered?pregunta=like.${encodeURIComponent(`*${MARCA}*`)}`, { method: "DELETE", headers }),
  ];
  const r = await Promise.all(pedidos);
  const fallidos = r.filter((x) => !x.ok && x.status !== 400 && x.status !== 404);
  if (fallidos.length) console.warn(`limpiar: ${fallidos.length} pedido(s) fallaron (${fallidos.map((x) => x.status).join(", ")})`);
}
