"use client"

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, ReactNode } from "react"
import { ThemeSync } from "@/components/theme/theme-sync"
import { Toaster } from "@/components/ui/sonner"
import { SESSION_KEY } from "@/lib/session"
import { useTheme } from "@/lib/theme"

export function Providers({ children }: { children: ReactNode }) {
  const resolved = useTheme((s) => s.resolved)
  const [client] = useState(() => {
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error, query) => {
          if (error instanceof Error && error.message === "Unauthorized" && query.queryKey[0] !== SESSION_KEY[0]) {
            qc.invalidateQueries({ queryKey: SESSION_KEY })
          }
        },
      }),
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: 10_000,
        },
      },
    })
    return qc
  })
  return (
    <QueryClientProvider client={client}>
      <ThemeSync />
      {children}
      <Toaster theme={resolved === "studio" ? "light" : "dark"} position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  )
}
