import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: "AgentTrace — agent observability",
  description:
    "Watch autonomous and multi-agent systems run in real time. A live sequence diagram for AI engineers debugging agents.",
  keywords: ["agent observability", "tracing", "LLM", "sequence diagram", "AI agents"],
  icons: { icon: "/logo.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
