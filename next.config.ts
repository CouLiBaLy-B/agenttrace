import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow the gateway / preview hostnames to load /_next/* dev assets.
  // The app is served via a Caddy gateway on :81 (and a preview domain),
  // which reverse-proxies to this dev server on :3000.
  allowedDevOrigins: [
    "http://127.0.0.1:81",
    "http://localhost:81",
    "http://0.0.0.0:81",
    "http://*.space-z.ai",
    "http://*.chatglm.cn",
    "https://*.space-z.ai",
    "https://*.chatglm.cn",
  ],
};

export default nextConfig;
