"use client"

import { useState } from "react"
import { useAuthActions } from "@/lib/session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Mail, Lock, User, ArrowRight } from "lucide-react"
import { DemoLoop } from "@/components/demo/demo-loop"
import { TraceLogo } from "@/components/trace-logo"
import { useMediaQuery } from "@/lib/hooks"

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const { signIn, signUp } = useAuthActions()
  // The demo only plays beside the form on wide screens (not mounted otherwise).
  const wide = useMediaQuery("(min-width: 1024px)")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error("Enter your email and password")
      return
    }
    if (mode === "signup" && password.length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }
    setLoading(true)
    try {
      if (mode === "signup") await signUp(email, password, name)
      else await signIn(email, password)
      toast.success(mode === "signup" ? "Account created" : "Signed in")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[minmax(400px,5fr)_7fr]">
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2">
            <TraceLogo className="text-primary" />
            <span className="text-base font-semibold tracking-tight">LaneTrace</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin"
              ? "Sign in to open your traces."
              : "Tip: load sample projects later from Settings → Demo data."}
          </p>

          <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className="pl-9 bg-(--surface-2)"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.dev"
                  className="pl-9 bg-(--surface-2)"
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 bg-(--surface-2)"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full group">
              {loading ? (
                "Working…"
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Create account"}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>
        </div>
      </main>

      {wide && (
        <aside className="flex min-w-0 items-center justify-center border-l border-border bg-background p-10 xl:p-14">
          <figure className="w-full max-w-[720px]">
            <div
              className="overflow-hidden border border-border"
              style={{ borderRadius: "var(--radius-panel)", boxShadow: "var(--shadow-raised)" }}
            >
              <DemoLoop />
            </div>
            <figcaption className="mt-3 text-sm text-muted-foreground">
              A live sequence diagram of your agent&apos;s signals.
            </figcaption>
          </figure>
        </aside>
      )}
    </div>
  )
}
