# AgentTrace — Documentation fonctionnelle

> Plateforme d'observabilité pour ingénieurs IA construisant et déboguant des systèmes autonomes ou multi-agents. Le diagramme de séquence live est l'élément central du produit.

---

## 1. Présentation du produit

### 1.1 Problématique

Quand un agent autonome (ou un orchestrateur multi-agents) tourne, il enchaîne des appels LLM, des appels d'outils, des délégations à des sous-agents et des erreurs — le tout de façon asynchrone et difficile à suivre. Les logs traditionnels ne montrent pas **qui a parlé à qui, dans quel ordre, et combien de temps**. Sans cette visibilité, déboguer un agent qui se trompe ou boucle devient un travail d'archéologie.

### 1.2 Solution

AgentTrace stream les événements d'un agent en temps réel vers un **diagramme de séquence animé inspiré d'UML** : une ligne de vie verticale par participant (User, Orchestrator, LLM, chaque outil, chaque sous-agent), chaque événement apparaissant comme une flèche horizontale de haut en bas dans l'ordre chronologique. On voit littéralement les signaux se déplacer dans le système.

### 1.3 Cas d'usage

| Cas | Bénéfice |
|---|---|
| Déboguer un agent qui boucle | Le diagramme montre la séquence exacte des appels et où le cycle recommence |
| Comprendre un échec intermittent | Le mode replay rejoue le run image par image (0.5×/1×/2×/instant) |
| Auditer une décision d'agent | Le panneau latéral expose le payload complet (prompt, résultat, latence) de chaque événement |
| Comparer des runs | Le dashboard agrège taux de succès, durée moyenne, mix d'événements par projet |
| Surveiller un agent en production | Le mode "listening" affiche les événements dès qu'ils arrivent, sans refresh |

### 1.4 Public cible

Ingénieurs IA et équipes ML ops qui :
- construisent des agents LangChain/LangGraph/DeepAgents/CrewAI/AutoGen
- ont besoin d'inspecter le comportement runtime d'un agent
- veulent un équivalent du "debugger pas-à-pas" pour les systèmes d'agents

---

## 2. Architecture

### 2.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    Navigateur (client)                       │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │  App Shell   │  │ Diagramme SVG  │  │  Panneau détail │  │
│  │  (sidebar +  │  │   (lifelines + │  │  (payload,      │  │
│  │   6 vues)    │  │   flèches)     │  │   latence)      │  │
│  └──────┬───────┘  └────────┬───────┘  └─────────────────┘  │
│         │ fetch REST         │ Socket.IO (ws)                │
└─────────┼────────────────────┼──────────────────────────────┘
          │                    │ io("/?XTransformPort=3003")
          ▼                    ▼
┌─────────────────────┐  ┌──────────────────────────────────┐
│  Next.js :3000      │  │  Socket.IO service :3003         │
│  (App Router)       │  │  (mini-service Bun)              │
│                     │  │                                  │
│  ┌───────────────┐  │  │  • rooms par runId               │
│  │ API routes    │──┼──│▶ • broadcast event → abonnés     │
│  │ /api/events   │  │  │ • replay (scheduler par client) │
│  │ /api/projects │  │  │   vitesse 0.5×/1×/2×/instant    │
│  │ /api/runs     │  │  └──────────────────────────────────┘
│  │ /api/keys     │  │
│  │ /api/stats    │  │  (le serveur Next.js se connecte au
│  │ /api/auth/*   │  │   socket service comme client pour
│  └──────┬────────┘  │   forwarder les events ingestion →
│         │           │   navigateurs abonnés)
│         ▼           │
│  ┌───────────────┐  │
│  │   Prisma      │  │
│  │   (SQLite)    │  │
│  └───────────────┘  │
└─────────────────────┘
          ▲
          │ POST /api/events (Bearer atr_...)
          │
┌─────────┴───────────────────────────────────────────────────┐
│              Agent externe (Python / TS / DeepAgents)        │
│  émet : handoff, llm_call, tool_call, tool_result, error,    │
│         final_answer                                         │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Composants

#### 2.2.1 Application Next.js (port 3000)

- **Framework** : Next.js 16, App Router, TypeScript, `output: standalone`
- **Auth** : NextAuth.js v4 (credentials email/password, JWT session)
- **State** : TanStack Query (server state) + Zustand (navigation locale)
- **UI** : Tailwind CSS 4 + shadcn/ui (New York), thème oscilloscope/phosphor
- **Animations** : Framer Motion (draw-in des flèches, transitions)

#### 2.2.2 Service Socket.IO (port 3003)

Mini-service Bun indépendant, path `/` (pour le gateway Caddy). Responsabilités :
- **Rooms par run** : un client s'abonne à `run:<id>` et ne reçoit que les events de ce run
- **Forward server→client** : le serveur Next.js s'y connecte comme client et émet `ingest:event` / `ingest:run` qui sont diffusés aux rooms
- **Replay scheduler** : chaque client peut demander `replay { events, speed }` et reçoit les événements un par un selon l'échelle de temps demandée

#### 2.2.3 Base de données

Prisma + SQLite (par défaut ; Postgres en production). Voir §3.

#### 2.2.4 Gateway Caddy (port 81)

Un seul port exposé à l'utilisateur. Le gateway route :
- `/?XTransformPort=3003` → service socket (pour les WebSockets)
- tout le reste → Next.js :3000

### 2.3 Flux de données temps réel

Quand un agent externe émet un événement :

1. `POST /api/events` avec `Authorization: Bearer atr_<key>`
2. Le route authentifie la clé (hash SHA-256, lookup en base), vérifie le `runId` appartient au projet
3. L'événement est **persisté en base** (table `Event`, `seq` auto-incrémenté par run)
4. Le serveur Next.js **forward** au service socket via son client persistant (`ingest:event`)
5. Le service socket **diffuse** à tous les navigateurs abonnés à `run:<id>` via l'événement `event`
6. Le composant `SequenceDiagram` reçoit l'événement, l'ajoute à son state, la flèche **s'anime** (Framer Motion `pathLength`) et l'**auto-scroll** la garde visible

Latence typique bout-en-bout : < 100ms.

---

## 3. Modèle de données

### 3.1 Schéma Prisma

```
User 1───* Project 1───* Run 1───* Event
                └── 1───* ApiKey
User 1───* Account
User 1───* Session
```

### 3.2 Entités

#### User
| Champ | Type | Description |
|---|---|---|
| id | string (cuid) | PK |
| email | string (unique) | login |
| name | string? | affiché dans la sidebar |
| passwordHash | string? | bcrypt (null si OAuth) |
| createdAt / updatedAt | DateTime | |

#### Project
| Champ | Type | Description |
|---|---|---|
| id | string (cuid) | PK |
| name | string | ex. "Customer Support Agent" |
| description | string? | |
| userId | string | FK User (propriétaire) |
| createdAt / updatedAt | DateTime | |

Un projet = un agent. Regroupe ses runs. **Privé par utilisateur.**

#### Run
| Champ | Type | Description |
|---|---|---|
| id | string (cuid) | PK |
| projectId | string | FK Project |
| name | string | ex. "Refund — Order #4821" |
| status | string | `running` \| `completed` \| `failed` |
| startedAt | DateTime | auto à la création |
| endedAt | DateTime? | set quand `endRun` reçu |

#### Event
| Champ | Type | Description |
|---|---|---|
| id | string (cuid) | PK |
| runId | string | FK Run |
| timestamp | DateTime | auto |
| seq | int | ordre dans le run (0, 1, 2…) |
| source | string | participant émetteur (ex. "Orchestrator") |
| target | string | participant destinataire (ex. "web_search") |
| type | string | voir §4.1 |
| label | string? | court résumé affiché sur la flèche |
| payload | string (JSON) | prompt, résultat, args, erreur… |
| durationMs | int? | latence mesurée côté agent |
| status | string | `ok` \| `error` \| `pending` |

#### ApiKey
| Champ | Type | Description |
|---|---|---|
| id | string (cuid) | PK |
| projectId | string | FK Project |
| keyHash | string (unique) | SHA-256 de la clé complète |
| prefix | string | `atr_xxxxxxxx` (pour affichage) |
| label | string? | ex. "Default key" |
| lastUsedAt | DateTime? | mis à jour à chaque ingestion |

La clé complète (`atr_<32 hex>`) n'est montrée qu'une fois à la création. Le serveur ne stocke que son hash.

---

## 4. Fonctionnalités

### 4.1 Types d'événements et code couleur

Chaque type d'événement a une couleur dédiée (cohérente partout : flèches, badges, barres du dashboard, légende) :

| Type | Couleur | Sens | Flèche |
|---|---|---|---|
| `llm_call` | cyan `#22d3ee` | Appel à un modèle de langage | Orchestrator → LLM |
| `tool_call` | violet `#a78bfa` | L'agent invoque un outil | Orchestrator → tool |
| `tool_result` | vert `#34d399` | L'outil retourne son résultat | tool → Orchestrator |
| `handoff` | ambre `#fbbf24` | Délégation à un sous-agent | Orchestrator → Sub-agent |
| `error` | rouge `#f87171` | Échec (timeout, exception…) | tool → Orchestrator |
| `final_answer` | rose `#f472b6` | Réponse finale à l'utilisateur | Orchestrator → User |

### 4.2 Participants

Détectés automatiquement à partir du flux d'événements (première occurrence dans `source` ou `target`). Chaque participant a un **kind** déduit de son nom, qui détermine son icône et la teinte de sa ligne de vie :

| Kind | Détecté si le nom contient | Icône |
|---|---|---|
| `user` | "user" | User |
| `orchestrator` | "orchestrator", "agent", "main" | Cpu |
| `llm` | "llm", "gpt", "claude", "model" | BrainCircuit |
| `subagent` | "sub-agent", "subagent", "research", "assistant" | Bot |
| `tool` | (par défaut) | Wrench |

Les participants apparaissent dans l'ordre de première apparition (gauche → droite).

### 4.3 Le diagramme de séquence live (composant central)

C'est un **vrai composant React/SVG**, pas une lib de diagrammes re-rendue à chaque update. Caractéristiques :

- **Lignes de vie verticales** par participant, avec en-tête (icône + nom + kind), lignes pointillées
- **Flèches horizontales** entre lignes de vie, dessinées de haut en bas par ordre chrono
- **Animation d'entrée** : chaque flèche se dessine via `pathLength` Framer Motion (0→1 en 400ms), la pointe apparaît après le tracé, le label glisse en place
- **Auto-scroll** : le canvas scrolle pour garder le dernier événement visible (si l'utilisateur est près du bas)
- **Curseur live** : pendant un run `running`, un point phosphore balaie la ligne du bas
- **Clic sur une flèche** → ouvre le panneau latéral (desktop) ou la sheet (mobile) avec le payload complet
- **Sélection** : la flèche cliquée est surlignée (halo coloré)
- **Grille d'oscilloscope** : fond CRT avec graticule + scanlines, cohérent avec l'identité du produit
- **Axe temporel** : horodatage HH:MM:SS.ms à gauche de chaque événement
- **Self-loop** : si `source === target`, la flèche fait une boucle courbe

**Responsive** : sur écran large (≥768px), lifelines côte à côte ; sur mobile, bascule en **timeline empilée chronologique** (cartes par participant, flèches remplacées par un layout vertical).

### 4.4 Mode replay

Pour tout run (`completed`, `failed`, ou même `running`) :

- Bouton **Replay** → entre en mode replay (gèle la vue live, positionne à la fin)
- Contrôles : **Restart** ⏮ · **Play/Pause** ▶/⏸ · **Skip to end** ⏭ · **scrubber** · **sélecteur de vitesse** · **Exit**
- Vitesses : **0.5×** (ralenti), **1×** (temps réel), **2×** (accéléré), **instant** (tout d'un coup)
- La lecture schedule les événements selon leur `timestamp` réel (offset depuis le 1er événement), donc un run qui a duré 4s se rejoue en 4s à 1×, 8s à 0.5×, 2s à 2×
- L'utilisateur peut **scrubber** n'importe quand pour sauter à un événement précis
- Le serveur socket gère le scheduling par client (un replay n'affecte pas les autres clients abonnés)

### 4.5 Panneau de détail d'événement

Au clic sur une flèche (ou carte mobile) :

- **Badge type** coloré + label
- **Source → Target** avec icônes de kind
- **Métadonnées** : `#seq`, `status`, `timestamp`, `duration`
- **Payload** : JSON formaté et scrollable (prompt, résultat, args, erreur…)

### 4.6 État "listening"

Quand un run `running` n'a pas encore d'événement, le canvas affiche un **radar animé** (cercles concentriques + sweep rotatif) avec le message *"Listening for your agent's first event"* et un rappel du endpoint `POST /api/events`. Le 1er événement qui arrive remplace immédiatement cet état par le diagramme.

### 4.7 Authentification

- **Email/mot de passe** via NextAuth credentials provider (bcrypt hash)
- **Mode signup** : crée le user + **auto-seed 3 projets de démo** (Customer Support Agent, Research Assistant, Code Review Bot)
- **"Explore the live demo"** : bouton one-click qui crée/identifie un compte `demo@agenttrace.dev` préchargé
- **Session JWT** (pas de DB session pour rester léger)
- **Pas d'OAuth Google** dans cette version (le type OAuth est prêt côté NextAuth mais le provider n'est pas configuré — voir §Limitations)

### 4.8 Gestion des projets (CRUD)

- **Liste** : cartes avec nom, description, nb de runs, dernière activité, actions (éditer/supprimer)
- **Création** : dialog nom + description → génère aussi une clé API par défaut
- **Édition** : renomme / change la description (optimistic update + rollback)
- **Suppression** : confirmation required, cascade (runs + events + keys)
- **Accès** : un user ne voit que ses propres projets (filter `userId` à chaque query)

### 4.9 Gestion des runs

- **Création** : bouton "Start a run" dans la vue projet → ouvre directement la vue run en mode listening
- **Fermeture** : bouton "Close run" (marquer completed ou failed)
- **Suppression** : avec confirmation
- **Filtre** par nom dans la liste

### 4.10 Dashboard

Stats agrégées pour l'utilisateur connecté :
- **5 cartes** : Projects, Total runs, Success rate, Avg duration, Events captured
- **Signal mix** : barres horizontales par type d'événement (% du total)
- **Recent activity** : 8 derniers runs (cliquables → vue run)
- **Per-project grid** : cartes projet avec runs + success rate + dernière activité
- **Empty state** : si 0 projet → radar + CTA "Create your first project"

### 4.11 Page Integration

- **Sélecteur de projet**
- **Bouton "Regenerate key"** → crée une nouvelle clé, l'affiche une fois (bannière ambre avec copie)
- **Liste des clés** : prefix, label, dernière utilisation, bouton revoke
- **3 snippets** copiables : Python (HTTP brut), TypeScript (fetch), **DeepAgents** (`AgentTraceMiddleware`, package publié `agenttrace-langchain`)
- **Référence API** : endpoints + schéma du body d'événement

### 4.12 Optimistic updates

Création/édition de projet et création de run se font en **optimistic** : l'UI se met à jour instantanément avec un objet temporaire, et **rollback** proprement avec un toast explicatif si le serveur échoue (ex. *"Couldn't create the project — rolled back."*). Pas d'excuses apologétiques, juste l'état réel.

### 4.13 États vides

Traités comme des **invitations à agir**, pas des placeholders :
- 0 projet → radar + "Create your first project"
- Projet sans run → radar + "Listening for your agent's first event" + snippet inline
- Run sans événement → radar + endpoint de reminder

### 4.14 Loading states

- **Skeletons** sur le dashboard, la liste de projets, le détail projet, la vue run
- **Boot screen** animé pendant le check de session
- **"listening…"** pulsant avant le 1er événement d'un run

### 4.15 Design system

**Identité visuelle** : oscilloscope / trace-debugger, pas SaaS générique.
- Fond : charcoal-teal profond (`oklch(0.16 0.012 195)`)
- Primaire : vert phosphore (`oklch(0.78 0.17 155)`) avec glow
- Événements : cyan/violet/vert/ambre/rouge/rose (cf §4.1)
- Texture : grille graticule CRT, scanlines, glow text, pulse rings, radar sweep
- Typo : Geist Sans + Geist Mono (labels en mono uppercase tracking-widest)
- Scrollbar custom phosphore

### 4.16 Responsive

- **Sidebar** : fixe sur desktop (≥1024px), drawer Sheet sur mobile (bouton hamburger)
- **Diagramme** : lifelines côte à côte sur ≥768px, timeline empilée en dessous
- **Panneau détail** : sidebar fixe sur ≥1280px, Sheet plein écran sur mobile
- **Footer** : sticky en bas, pousse naturellement si contenu long

---

## 5. API d'ingestion

### 5.1 Endpoint

`POST /api/events`

**Auth** : `Authorization: Bearer atr_<clé projet>`

### 5.2 Corps (JSON)

```jsonc
{
  "runId": "run_abc123",        // null/omit → crée un nouveau run
  "source": "Orchestrator",
  "target": "web_search",
  "type": "tool_call",          // llm_call | tool_call | tool_result | handoff | error | final_answer
  "label": "web_search(query)", // court, affiché sur la flèche
  "payload": { "args": {...} }, // any JSON
  "durationMs": 720,
  "status": "ok",               // ok | error | pending (defaut: ok, ou "error" si type=error)
  "endRun": "completed"         // optionnel: "completed" | "failed" pour fermer le run
}
```

### 5.3 Réponses

| Cas | Status | Body |
|---|---|---|
| Création de run (`runId: null`) | 201 | `{ runId, event: null }` |
| Événement ingéré | 201 | `{ runId, event }` |
| Fermeture de run (`endRun`) | 200 | `{ runId, closed: true, status }` |
| Clé invalide | 401 | `{ error }` |
| Run non trouvé / mauvais projet | 404 | `{ error }` |
| Champ manquant | 400 | `{ error }` |

### 5.4 Autres endpoints

| Méthode | Path | Description |
|---|---|---|
| GET | `/api/projects` | Liste projets user (avec counts) |
| POST | `/api/projects` | Créer projet (+ clé auto) |
| GET/PATCH/DELETE | `/api/projects/[id]` | Détail / renomme / supprime |
| GET/POST | `/api/projects/[id]/runs` | Liste runs / crée run |
| GET/PATCH/DELETE | `/api/runs/[id]` | Détail (avec events) / update status / supprime |
| GET | `/api/runs/[id]/events` | Events d'un run |
| GET/POST | `/api/keys?projectId=` | Liste / régénère clés |
| DELETE | `/api/keys/[id]?projectId=` | Révoque une clé |
| GET | `/api/stats` | Stats dashboard |
| POST | `/api/seed` | Re-seed les 3 projets démo |
| GET/POST | `/api/auth/*` | NextAuth (signin, signup, session) |

---

## 6. Sécurité

- **Mots de passe** : bcrypt (cost 10)
- **Clés API** : hash SHA-256 stocké, clé complète jamais persistée, montrée une seule fois à la création
- **Isolation** : chaque query filtre par `userId` (un user ne peut pas accéder aux projets/runs d'un autre)
- **Auth ingestion** : la clé API authentifie le projet, pas la session user — un agent externe n'a pas besoin de credentials user
- **NextAuth secret** : requis (`NEXTAUTH_SECRET`), utilisé pour signer les JWT
- **Limitations** (à durcir pour prod) :
  - Pas de rate limiting sur `/api/events`
  - Pas de CSRF custom (NextAuth gère le sien)
  - SQLite par défaut (voir §7 pour Postgres)

---

## 7. Déploiement

### 7.1 Docker

Deux images depuis un `Dockerfile` multi-stage :

| Image | Target | Port | Rôle |
|---|---|---|---|
| `agenttrace-web` | `web` | 3000 | Next.js standalone + Prisma |
| `agenttrace-socket` | `socket` | 3003 | Socket.IO service |

```bash
docker compose up --build
```

Le `docker-compose.yml` câble `SOCKET_SERVICE_URL=http://socket:3003` côté web, et un volume persiste la base SQLite.

### 7.2 Production

- **Base** : basculer sur Postgres — `DATABASE_URL=postgresql://...` + `provider = "postgresql"` dans `schema.prisma`
- **Secrets** : `NEXTAUTH_SECRET` via `openssl rand -base64 32`, `NEXTAUTH_URL` = URL publique
- **Reverse proxy** : Caddy/Nginx devant, qui route `?XTransformPort=3003` vers le service socket (comme en dev)

### 7.3 CI

`.github/workflows/ci.yml` : lint → typecheck → build → docker build + smoke test, sur chaque push/PR. Cache GHA activé.

---

## 8. Limitations & roadmap

### 8.1 Implémenté
Tout le périmètre du prompt initial : diagramme live, replay, CRUD, ingestion API, 3 projets seed, auth, design oscilloscope, responsive, Docker, CI, snippets Python/TS/DeepAgents.

### 8.2 Nice-to-haves non faits
- **Team/workspace sharing** : les projets sont privés par user (pas de partage multi-user)
- **OpenTelemetry** : ingestion uniquement via le format AgentTrace natif (pas de receiver OTel)
- **Export** : pas d'export en lien partageable read-only ni en image statique du diagramme
- **OAuth Google** : provider credentials uniquement (l'ajout Google OAuth = 10 lignes dans `auth.ts`)

### 8.3 Axes d'amélioration
- Rate limiting + quotas par clé
- Search full-text dans les payloads
- Diff entre deux runs
- Streaming des payloads volumineux (truncation actuelle à 500 chars côté callback DeepAgents)
- Alerting (notification Slack/email sur `error` ou run failed)
