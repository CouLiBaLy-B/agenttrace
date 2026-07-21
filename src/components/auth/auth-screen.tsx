"use client"

import { useState } from "react"
import { signIn } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Activity, Mail, Lock, User, ArrowRight } from "lucide-react"

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)

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
    const res = await signIn("credentials", {
      email,
      password,
      name: mode === "signup" ? name : undefined,
      mode,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      toast.error(
        mode === "signup"
          ? "Couldn't create the account — an account with this email may already exist."
          : "Invalid email or password. If you're new, switch to Create account."
      )
      return
    }
    toast.success(mode === "signup" ? "Account created — demo projects loaded" : "Signed in")
    setTimeout(() => window.location.reload(), 400)
  }

  const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@agenttrace.dev"
  const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "demo1234"

  const demoLogin = async () => {
    setLoading(true)
    const res = await signIn("credentials", {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      mode: "signin",
      redirect: false,
    })
    if (res?.error) {
      const res2 = await signIn("credentials", {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: "Demo Engineer",
        mode: "signup",
        redirect: false,
      })
      if (res2?.error) {
        setLoading(false)
        toast.error("Couldn't start the demo. Try creating an account manually.")
        return
      }
    }
    setLoading(false)
    toast.success("Demo session ready — three sample projects loaded")
    setTimeout(() => window.location.reload(), 400)
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="relative hidden lg:flex flex-1 at-graticule at-scanlines overflow-hidden">
        <div className="relative z-10 flex flex-col justify-between p-10 w-full">
          <div className="flex items-center gap-2">
            <TraceLogo />
            <span className="font-mono text-sm tracking-[0.3em] text-primary/90 at-glow uppercase">
              AgentTrace
            </span>
          </div>

          <div className="max-w-md">
            <h1 className="font-mono text-3xl xl:text-4xl leading-tight text-foreground">
              Watch signals move
              <br />
              <span className="text-primary at-glow">through your agents.</span>
            </h1>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              A live sequence diagram for AI engineers building autonomous and multi-agent
              systems. Stream LLM calls, tool calls, handoffs, and errors — then replay any run
              frame by frame.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-3 max-w-sm">
              <ScopeStat label="llm_call" color="#22d3ee" />
              <ScopeStat label="tool_call" color="#a78bfa" />
              <ScopeStat label="handoff" color="#fbbf24" />
            </div>
          </div>

          <div className="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase">
            {"// trace · replay · debug"}
          </div>
        </div>

        <svg
          className="absolute bottom-0 left-0 w-full h-32 opacity-50"
          viewBox="0 0 800 120"
          preserveAspectRatio="none"
        >
          <path
            d="M0 60 L80 60 L100 30 L130 90 L160 20 L195 100 L220 60 L300 60 L320 40 L350 80 L380 60 L500 60 L520 25 L555 95 L590 60 L800 60"
            fill="none"
            stroke="oklch(0.78 0.17 155)"
            strokeWidth="1.5"
            className="at-glow"
          />
        </svg>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <TraceLogo />
            <span className="font-mono text-sm tracking-[0.3em] text-primary/90 at-glow uppercase">
              AgentTrace
            </span>
          </div>

          <h2 className="text-xl font-semibold">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin"
              ? "Sign in to open your traces."
              : "We'll load three demo projects to get you started."}
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
                <Label htmlFor="name" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Name
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className="pl-9 bg-card"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.dev"
                  className="pl-9 bg-card"
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 bg-card"
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

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={demoLogin}
          >
            <Activity className="mr-2 h-4 w-4 text-primary" />
            Explore the live demo
          </Button>
          <p className="text-center text-[11px] text-muted-foreground mt-3">
            Creates a throwaway account preloaded with sample traces.
          </p>
        </div>
      </div>
    </div>
  )
}

function TraceLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="text-primary">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <path
        d="M2 12 L7 12 L9 7 L11 17 L13 9 L15 15 L17 12 L22 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="at-glow"
      />
    </svg>
  )
}

function ScopeStat({ label, color }: { label: string; color: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
