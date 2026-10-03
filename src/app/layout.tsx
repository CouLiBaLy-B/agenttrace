import type { Metadata } from "next"
import "@fontsource/instrument-sans/400.css"
import "@fontsource/instrument-sans/600.css"
import "@fontsource/martian-mono/400.css"
import "@fontsource/martian-mono/500.css"
import "@fontsource/b612/400.css"
import "@fontsource/b612/700.css"
import "@fontsource/b612-mono/400.css"
import "@fontsource/bricolage-grotesque/500.css"
import "@fontsource/bricolage-grotesque/700.css"
import "@fontsource/dm-mono/400.css"
import "@fontsource/dm-mono/500.css"
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
    <html lang="en" data-theme="cyanotype" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
