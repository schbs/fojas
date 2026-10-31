// Pasa lo que hay en el portapapeles de Windows a una variable de .env.local, sin mostrarlo, y después vacía el portapapeles.
// Uso: node scripts/pegar-del-portapapeles.mjs WHATSAPP_TOKEN [prefijo esperado]
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [nombre, prefijo] = process.argv.slice(2);
if (!/^[A-Z][A-Z0-9_]*$/.test(nombre ?? "")) {
  console.error("Uso: node scripts/pegar-del-portapapeles.mjs NOMBRE_VARIABLE [prefijo]");
  process.exit(1);
}

const powershell = (comando) => execFileSync("powershell.exe", ["-NoProfile", "-Command", comando], { encoding: "utf8" });
const valor = powershell("Get-Clipboard -Raw").trim();

if (!valor || /\s/.test(valor)) {
  console.error(`No cargué ${nombre}: el portapapeles está vacío o tiene espacios (¿copiaste otra cosa?).`);
  process.exit(1);
}
if (prefijo && !valor.startsWith(prefijo)) {
  console.error(`No cargué ${nombre}: lo copiado no empieza como se espera (${prefijo}…).`);
  process.exit(1);
}

let env = fs.readFileSync(".env.local", "utf8");
const linea = new RegExp(`^${nombre}=.*$`, "m");
env = linea.test(env) ? env.replace(linea, () => `${nombre}=${valor}`) : `${env.trimEnd()}\n${nombre}=${valor}\n`;
fs.writeFileSync(".env.local", env);
powershell("Set-Clipboard -Value ' '");
console.log(`${nombre} cargada (${valor.length} caracteres). Portapapeles vaciado.`);
