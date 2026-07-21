"use client"

import { SessionProvider } from "@/lib/auth-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 10_000,
          },
        },
      })
  )
  return (
    <SessionProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </SessionProvider>
  )
}
