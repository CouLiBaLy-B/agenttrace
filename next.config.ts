import type { NextConfig } from "next";

// Static export: the FastAPI backend (python-server/) serves this build's
// output directly via StaticFiles — same origin as /api/* and /ws, so
// src/lib/api.ts's relative fetch paths just work with zero CORS config.
// `bun run dev` still works for iterating on the UI itself; point
// NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_WS_HOST (read in api.ts /
// sequence-diagram.tsx) at a separately-running `agenttrace ui` instance
// if you need live data while developing (`output: "export"` disables
// next.config rewrites/proxying, so this env-var escape hatch replaces it).
const nextConfig: NextConfig = {
  output: "export",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
