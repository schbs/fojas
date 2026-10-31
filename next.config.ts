import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El panel sube PDFs de hasta 4 MB por server action (el tope real lo valida la acción).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  poweredByHeader: false,
};

export default nextConfig;
