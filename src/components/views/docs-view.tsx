"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  BookOpen,
  FileText,
  Terminal,
  ExternalLink,
  Download,
  Workflow,
  Boxes,
  ShieldCheck,
} from "lucide-react"

export function DocsView() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {"// documentation"}
        </p>
        <h1 className="text-2xl font-semibold mt-0.5">Documentation</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          La documentation fonctionnelle et le mode d'emploi d'AgentTrace. Tout
          ce qu'il faut savoir pour instrumenter vos agents et lire les traces.
        </p>
      </div>

      {/* Two main docs */}
      <div className="grid md:grid-cols-2 gap-4">
        <DocCard
          icon={FileText}
          title="Documentation fonctionnelle"
          desc="Architecture, modèle de données, fonctionnalités, API, sécurité, déploiement. La spec complète du produit."
          file="docs/functional-documentation.md"
          accent="#34d399"
        />
        <DocCard
          icon={BookOpen}
          title="Mode d'emploi"
          desc="Démarrage, navigation, création de projets, lecture du diagramme, replay, intégration DeepAgents, FAQ."
          file="docs/user-manual.md"
          accent="#22d3ee"
        />
      </div>

      {/* Quick guides */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
          guides rapides
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <GuideCard
            icon={Terminal}
            title="Instrumenter en 30s"
            steps={[
              "Integration → copier la clé API",
              "Onglet Python/TS/DeepAgents",
              "Coller dans votre agent",
              "Lancer → le diagramme se remplit",
            ]}
          />
          <GuideCard
            icon={Workflow}
            title="Lire un diagramme"
            steps={[
              "Colonnes = participants",
              "Flèches = événements (chrono)",
              "Couleur = type (cf. légende)",
              "Clic → payload complet",
            ]}
          />
          <GuideCard
            icon={Boxes}
            title="Replay un run"
            steps={[
              "Vue run → bouton Replay",
              "Play ou scrubber",
              "Vitesse 0.5×/1×/2×/instant",
              "Exit pour revenir au live",
            ]}
          />
        </div>
      </div>

      {/* Types reference */}
      <Card className="p-5 at-graticule-fine">
        <div className="flex items-center gap-2 mb-4">
          <Workflow className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Types d'événements</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[
            { type: "llm_call", color: "#22d3ee", arrow: "Orchestrator → LLM", desc: "Appel à un modèle" },
            { type: "tool_call", color: "#a78bfa", arrow: "Orchestrator → tool", desc: "Invocation d'outil" },
            { type: "tool_result", color: "#34d399", arrow: "tool → Orchestrator", desc: "Résultat d'outil" },
            { type: "handoff", color: "#fbbf24", arrow: "Orchestrator → Sub-agent", desc: "Délégation" },
            { type: "error", color: "#f87171", arrow: "tool → Orchestrator", desc: "Échec" },
            { type: "final_answer", color: "#f472b6", arrow: "Orchestrator → User", desc: "Réponse finale" },
          ].map((e) => (
            <div
              key={e.type}
              className="rounded-md border border-border bg-background/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: e.color, boxShadow: `0 0 5px ${e.color}` }}
                />
                <code className="font-mono text-xs" style={{ color: e.color }}>
                  {e.type}
                </code>
              </div>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{e.arrow}</p>
              <p className="text-[11px] text-muted-foreground/80">{e.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Architecture summary */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Architecture en bref</h2>
        </div>
        <div className="space-y-2 font-mono text-xs text-muted-foreground">
          <ArchRow label="Next.js :3000" desc="App Router, API routes, Prisma, NextAuth" />
          <ArchRow label="Socket.IO :3003" desc="Live streaming + replay (mini-service Bun)" />
          <ArchRow label="SQLite / Postgres" desc="User, Project, Run, Event, ApiKey (Prisma)" />
          <ArchRow label="Gateway Caddy :81" desc="Route ?XTransformPort=3003 → socket, reste → web" />
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Le flux live : agent → <code className="text-primary/80">POST /api/events</code> (clé API) →
          DB persist + forward socket → navigateurs abonnés au run → flèches animées en temps réel.
        </p>
      </Card>

      {/* Links */}
      <Card className="p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
          fichiers
        </p>
        <div className="space-y-2">
          <FileLink
            icon={FileText}
            name="docs/functional-documentation.md"
            desc="Spec produit complète (454 lignes)"
          />
          <FileLink
            icon={BookOpen}
            name="docs/user-manual.md"
            desc="Mode d'emploi pas-à-pas (594 lignes)"
          />
          <FileLink
            icon={Terminal}
            name="README.md"
            desc="Quick start, Docker, CI, snippets"
          />
        </div>
      </Card>
    </div>
  )
}

function DocCard({
  icon: Icon,
  title,
  desc,
  file,
  accent,
}: {
  icon: any
  title: string
  desc: string
  file: string
  accent: string
}) {
  return (
    <Card className="p-5 hover:border-primary/40 transition-colors group">
      <div className="flex items-start gap-3">
        <div
          className="h-10 w-10 rounded-md flex items-center justify-center shrink-0 border"
          style={{ background: `${accent}15`, borderColor: `${accent}40` }}
        >
          <Icon className="h-5 w-5" style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
          <code className="mt-3 inline-block font-mono text-[10px] text-muted-foreground bg-background/60 border border-border rounded px-2 py-1">
            {file}
          </code>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => {
            // These are markdown files in the repo, not served routes —
            // tell the user where to find them.
            toastInfo(`Lisez ${file} dans le repo du projet`)
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ouvrir
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 ml-auto"
          onClick={() => toastInfo("Fichier dans le repo — voir /docs")}
        >
          <Download className="h-3.5 w-3.5" />
          Référence
        </Button>
      </div>
    </Card>
  )
}

function GuideCard({
  icon: Icon,
  title,
  steps,
}: {
  icon: any
  title: string
  steps: string[]
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-primary/70 shrink-0">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function ArchRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
      <code className="text-primary/90 shrink-0">{label}</code>
      <span className="text-muted-foreground">{desc}</span>
    </div>
  )
}

function FileLink({
  icon: Icon,
  name,
  desc,
}: {
  icon: any
  name: string
  desc: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 hover:border-primary/30 transition-colors">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <code className="font-mono text-xs">{name}</code>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
    </div>
  )
}

function toastInfo(msg: string) {
  import("sonner").then(({ toast }) => toast.info(msg))
}
