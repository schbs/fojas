// E2E con Playwright sobre el build de producción, usando Brave (ya instalado: no se descargan navegadores).
// Corren contra Supabase y Gemini reales (las variables de .env.local las carga Next): una corrida usa ≈ 3 llamadas al
// modelo y unos pocos embeddings. Lo que crean (el PDF de prueba y las consultas marcadas [e2e]) se borra al terminar.
import path from "node:path";
import { defineConfig } from "@playwright/test";

const BRAVE = process.env.BRAVE_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "BraveSoftware/Brave-Browser/Application/brave.exe");
const PUERTO = 3213;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/preparar.ts",
  globalTeardown: "./tests/e2e/limpiar.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    launchOptions: { executablePath: BRAVE },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  },
  webServer: {
    command: `npx next start -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "celular", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "compu", use: { viewport: { width: 1440, height: 900 } }, testMatch: /accesibilidad\.spec\.ts/ },
  ],
});
