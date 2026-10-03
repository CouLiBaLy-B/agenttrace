import type { NextConfig } from "next"

// Production builds are a static export served by the Python package
// (`agenttrace ui`). In development, `next dev` proxies the API to a
// running `agenttrace ui` (default http://127.0.0.1:3000); the WebSocket
// connects directly via NEXT_PUBLIC_AGENTTRACE_WS_URL.
const isDev = process.env.NODE_ENV === "development"
const backend = process.env.AGENTTRACE_DEV_BACKEND ?? "http://127.0.0.1:3000"

const nextConfig: NextConfig = {
  reactStrictMode: false,
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]
        },
      }
    : { output: "export", images: { unoptimized: true } }),
}

export default nextConfig
