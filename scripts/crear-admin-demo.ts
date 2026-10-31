// Crea (o actualiza) el usuario de demo del panel /admin en Supabase Auth, con app_metadata.rol = "admin" y una
// contraseña nueva al azar. Las credenciales quedan en data/admin-demo.json (fuera de git), sin imprimirlas: de ahí
// las leen los e2e y Germán para entrar al panel.
// Uso: npx tsx scripts/crear-admin-demo.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: falla abajo con un mensaje claro
}

const EMAIL = "admin-demo@example.com";
export const ARCHIVO_CREDENCIALES = path.join("data", "admin-demo.json");

async function main() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) throw new Error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY (npm run check-env).");
  const headers = { apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  const password = crypto.randomBytes(18).toString("base64url");
  const datos = { password, email_confirm: true, app_metadata: { rol: "admin" }, user_metadata: { demo: true } };

  const lista = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!lista.ok) throw new Error(`Auth listar → ${lista.status}`);
  const existente = ((await lista.json()) as { users: { id: string; email?: string }[] }).users.find((u) => u.email === EMAIL);

  const r = existente
    ? await fetch(`${url}/auth/v1/admin/users/${existente.id}`, { method: "PUT", headers, body: JSON.stringify(datos) })
    : await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email: EMAIL, ...datos }) });
  if (!r.ok) throw new Error(`Auth ${existente ? "actualizar" : "crear"} → ${r.status}: ${(await r.text()).slice(0, 200)}`);

  fs.writeFileSync(ARCHIVO_CREDENCIALES, JSON.stringify({ email: EMAIL, password }, null, 2) + "\n", { mode: 0o600 });
  console.log(`✓ Usuario ${EMAIL} ${existente ? "actualizado" : "creado"} con rol admin. Credenciales en ${ARCHIVO_CREDENCIALES} (fuera de git).`);
}

void main().catch((e) => {
  console.error("Falló:", e instanceof Error ? e.message : e);
  process.exit(1);
});
