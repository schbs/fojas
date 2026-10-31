import { crearManejadorAsk } from "@/api/ask";
import { dependenciasReales } from "@/rag/dependencias";

export const POST = crearManejadorAsk({ dependencias: () => dependenciasReales() });
