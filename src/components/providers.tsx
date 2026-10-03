"use client"

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { SESSION_KEY } from "@/lib/session"

export function Providers({ children }: { children: ReactNode }) {
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
      {children}
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  )
}
