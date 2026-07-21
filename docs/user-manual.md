# AgentTrace — Mode d'emploi

> Guide pratique pour démarrer, utiliser au quotidien et instrumenter vos agents.

---

## Sommaire

1. [Démarrage](#1-démarrage)
2. [Navigation](#2-navigation)
3. [Créer un projet](#3-créer-un-projet)
4. [Démarrer et suivre un run](#4-démarrer-et-suivre-un-run)
5. [Lire le diagramme de séquence](#5-lire-le-diagramme-de-séquence)
6. [Rejouer un run (mode replay)](#6-rejouer-un-run-mode-replay)
7. [Inspecter un événement](#7-inspecter-un-événement)
8. [Gérer les clés API](#8-gérer-les-clés-api)
9. [Instrumenter un agent](#9-instrumenter-un-agent)
   - 9.1 [Python (HTTP brut)](#91-python-http-brut)
   - 9.2 [TypeScript](#92-typescript)
   - 9.3 [DeepAgents (LangChain)](#93-deepagents-langchain)
10. [Dashboard & stats](#10-dashboard--stats)
11. [Settings](#11-settings)
12. [Déploiement Docker](#12-déploiement-docker)
13. [FAQ](#13-faq)

---

## 1. Démarrage

### 1.1 Premier accès

Ouvrez l'application dans le panneau de preview (à droite). Vous arrivez sur l'écran d'authentification, divisé en deux :

- **À gauche** : panneau signal avec le logo, le pitch produit et un waveform décoratif (vibe oscilloscope)
- **À droite** : le formulaire avec deux onglets

### 1.2 Trois façons d'entrer

#### Option A — Explorer la démo (recommandé pour découvrir)

Cliquez le bouton **"Explore the live demo"** en bas du formulaire. Cela crée (ou réutilise) un compte `demo@agenttrace.dev` **préchargé avec 3 projets de démonstration** :

1. **Customer Support Agent** — flux de remboursement avec retry sur timeout de passerelle
2. **Research Assistant** — délégation à un sous-agent "Web Search" (web_search + 3 fetch_page parallèles)
3. **Code Review Bot** — déclenché par webhook PR (fetch_diff → analyse LLM → post_comment)

Chaque projet a 3–5 runs complétés. Vous pouvez tout de suite ouvrir un run et voir le diagramme.

#### Option B — Créer un compte

1. Onglet **"Create account"**
2. Remplissez **Name**, **Email**, **Password** (≥6 caractères)
3. Cliquez **"Create account"**

Le compte est créé et **les mêmes 3 projets de démo sont chargés automatiquement** pour que l'app soit vivante immédiatement. Vous pourrez les supprimer et créer les vôtres.

#### Option C — Se connecter à un compte existant

Onglet **"Sign in"** → email + password → **"Sign in"**.

> En cas d'échec, le toast indique clairement : *"Invalid email or password. If you're new, switch to Create account."*

---

## 2. Navigation

L'app est une SPA (single page) avec navigation par état. La **sidebar** (à gauche sur desktop, drawer sur mobile) contient 4 entrées :

| Entrée | Rôle |
|---|---|
| **Dashboard** | Vue d'ensemble : stats, activité récente, projets |
| **Projects** | Liste et CRUD des projets → détail projet → runs → run |
| **Integration** | Clés API + snippets de code (Python/TS/DeepAgents) |
| **Settings** | Compte, rechargement démo, préférences |

En bas de la sidebar : un indicateur **"ingestion online"** pulsant (le service socket est joignable) et votre profil avec bouton **sign out**.

Le **footer** (sticky en bas) rappelle l'état d'ingestion, le port socket, la vue courante et la version.

---

## 3. Créer un projet

Un **projet** = un agent. Il regroupe tous les runs d'un même agent et porte une clé d'API d'ingestion.

1. Allez dans **Projects** (sidebar)
2. Cliquez **"New project"** (en haut à droite)
3. Dans le dialog :
   - **Name** (requis) — ex. "Customer Support Agent"
   - **Description** (optionnel) — ex. "Handles refund requests end-to-end"
4. Cliquez **"Create project"**

Une **clé API est générée automatiquement**. Vous êtes redirigé vers la vue détail du projet.

> La création est **optimistic** : le projet apparaît instantanément dans la liste. Si le serveur échoue, il disparaît avec un toast *"Couldn't create the project — rolled back."*

### 3.1 Éditer / supprimer un projet

Sur chaque carte projet, au survol :
- ✏️ **Éditer** (icône crayon) → dialog de renommage
- 🗑️ **Supprimer** (icône poubelle) → confirmation requise

La suppression est en cascade : tous les runs, événements et clés du projet sont supprimés.

---

## 4. Démarrer et suivre un run

### 4.1 Démarrer un run depuis l'UI

1. Ouvrez un projet
2. Cliquez **"Start a run"** (en haut à droite)
3. Donnez un nom (ex. "Refund — Order #4821")
4. Cliquez **"Start run"**

Vous arrivez sur la **vue run** avec le canvas affichant l'état **"Listening for your agent's first event"** (radar animé). Le run a le statut `running`.

### 4.2 Démarrer un run depuis votre agent (API)

C'est le cas normal en production : votre agent crée le run et émet les événements via `POST /api/events`. Voir §9.

### 4.3 L'état "listening"

Tant qu'aucun événement n'est arrivé, le canvas montre :
- Un **radar** (cercles concentriques + sweep rotatif vert phosphore)
- Le message *"Listening for your agent's first event"*
- Le rappel `POST /api/events · run <id>…`

Dès le 1er événement, le diagramme le remplace. Si votre agent ne répond pas, vérifiez :
- la clé API (page Integration)
- le `runId` passé (doit correspondre à un run du bon projet)
- que le service socket tourne (port 3003)

### 4.4 Fermer un run

Un run ouvert depuis l'UI reste `running` jusqu'à :
- la réception d'un événement avec `endRun: "completed"` ou `"failed"` depuis votre agent (recommandé)
- **ou** le bouton **"Close run"** dans la vue run → choisir "Mark completed" ou "Mark failed"

### 4.5 Supprimer un run

Bouton poubelle dans la vue run, avec confirmation.

---

## 5. Lire le diagramme de séquence

Le diagramme est le composant central. Voici comment le lire.

### 5.1 Anatomie

```
┌────────┬─────────────┬─────────────┬─────────────┬──────────┐
│ temps  │   User      │ Orchestrator│     LLM     │ web_search│
│        │  👤 user    │  🖥️ orch.   │  🧠 llm     │  🔧 tool  │
│        │  ┊          │  ┊          │  ┊          │  ┊        │
│ 10:24  │  ┊──────────▶┊            │            │           │ ← handoff
│        │            │  ┊──────────▶┊            │           │ ← llm_call
│        │            │  ┊───────────┊───────────▶┊           │ ← tool_call
│        │            │  ┊◀──────────┊────────────┊           │ ← tool_result
│        │  ┊◀─────────┊            │            │           │ ← final_answer
│        │  ┊          │  ┊          │  ┊          │  ┊        │
└────────┴─────────────┴─────────────┴─────────────┴──────────┘
                                               cursor live ▶ (si running)
```

- **Colonnes** = participants, une par ligne de vie verticale (pointillée)
- **En-tête** : icône + nom + kind (en mono, coloré par kind)
- **Flèches** = événements, de haut en bas dans l'ordre chrono
- **Couleur** = type d'événement (cf. légende en haut de la vue run)
- **Label** au-dessus de la flèche : court résumé (`web_search(query)`)
- **Sous-label** : `type · durationMs` (ex. `tool call · 640ms`)
- **Axe temps** à gauche : `HH:MM:SS.ms`

### 5.2 Comportement live

- Les nouvelles flèches **s'animent** à l'arrivée (draw-in 400ms + apparition pointe/label)
- **Auto-scroll** garde le dernier événement visible si vous êtes près du bas
- Un **curseur phosphore** balaie la ligne du bas tant que le run est `running`
- Le badge en haut à gauche indique **"listening"** (vert pulsant) ou **"connecting…"** si le socket se reconnecte

### 5.3 Plus de 6 participants

Si le flux fait apparaître beaucoup de participants, le canvas **scroll horizontalement** automatiquement (les lignes de vie ont une largeur fixe de 150px). L'auto-scroll suit aussi horizontalement le dernier événement.

### 5.4 Version mobile

Sur écran < 768px, le diagramme bascule en **timeline empilée** : chaque événement est une carte avec numéro de séquence, badge type coloré, `source → target` (icônes + noms), label, et durée. Le clic ouvre la même fiche détail (en Sheet plein écran).

---

## 6. Rejouer un run (mode replay)

Le replay permet de revivre un run image par image, pour debug ou démo.

### 6.1 Entrer en replay

Sur n'importe quelle vue run, cliquez **"Replay"** (en haut à droite de la toolbar du canvas). La vue passe en mode replay :
- Le diagramme se fige à la fin
- Les contrôles replay apparaissent

### 6.2 Contrôles

```
[⏮ Restart]  [▶ Play/Pause]  [⏭ Skip to end]  ━━●━━━━━━ 5/13  [1× ▼]  [Exit]
```

- **Restart** ⏮ : revient au 1er événement
- **Play/Pause** ▶/⏸ : lance la lecture ou la pause
- **Skip to end** ⏭ : saute au dernier événement
- **Scrubber** : glissez pour naviguer librement dans la timeline
- **Compteur** `5/13` : position courante / total
- **Vitesse** : cliquez `1×` → menu déroulant
  - **0.5×** : ralenti (2× plus lent que le réel)
  - **1×** : temps réel (un run de 4s se rejoue en 4s)
  - **2×** : accéléré
  - **instant** : tous les événements d'un coup
- **Exit** : quitte le replay, revient en vue live

### 6.3 Comment ça marche

Le replay est **par client** : le serveur socket schedule l'émission des événements uniquement vers votre navigateur, selon les timestamps réels. Les autres clients abonnés au même run ne sont pas affectés.

### 6.4 Cas d'usage

- **Debug** : replay à 0.5× pour bien voir l'enchaînement avant l'erreur
- **Démo** : replay à 2× pour montrer un run long en accéléré
- **Analyse** : scrubber pour sauter directement à l'événement suspect

---

## 7. Inspecter un événement

### 7.1 Ouvrir le panneau détail

Cliquez sur **n'importe quelle flèche** du diagramme (ou carte en mobile).

- **Desktop large (≥1280px)** : un **panneau latéral** s'ouvre à droite
- **Mobile / desktop étroit** : une **Sheet** glisse depuis la droite

### 7.2 Contenu du panneau

```
┌─ EVENT PAYLOAD ──────────────────┐
│ [tool_call]                       │ ← badge type coloré
│ web_search(query)                 │ ← label
│                                   │
│ ┌─────────────────────────────┐  │
│ │ 🖥️ Orchestrator  →  🔧 web_search │ ← source → target
│ └─────────────────────────────┘  │
│                                   │
│ sequence   status      timestamp  duration
│ #2         ok          10:24:11   640ms    ← métadonnées
│                                   │
│ PAYLOAD                           │
│ ┌─────────────────────────────┐  │
│ │ {                           │  │
│ │   "args": {                 │  │ ← JSON formaté scrollable
│ │     "query": "Rust web..."  │  │
│ │   }                         │  │
│ │ }                           │  │
│ └─────────────────────────────┘  │
└───────────────────────────────────┘
```

Pour fermer : bouton **×** (desktop) ou tap hors de la Sheet (mobile).

---

## 8. Gérer les clés API

Allez dans **Integration** (sidebar).

### 8.1 Sélectionner un projet

Le sélecteur en haut affiche tous vos projets. La clé et les snippets se mettent à jour pour le projet sélectionné.

### 8.2 Régénérer une clé

1. Cliquez **"Regenerate key"**
2. Une **bannière ambre** apparaît avec la clé complète : `atr_<32 hex>`
3. **Copiez-la maintenant** avec le bouton "Copy" — elle ne sera plus jamais affichée
4. Cliquez "Dismiss" quand vous l'avez stockée

> Toast : *"Key regenerated"*

L'ancienne clé continue de fonctionner (elle reste dans la liste). Pour la révoquer, voir §8.3.

### 8.3 Liste des clés

Sous le bouton, la liste affiche chaque clé :
- **Prefix** : `atr_xxxxxxxx…` (les 8 premiers chars)
- **Label** : "Default key" par défaut
- **Dernière utilisation** : "used 2m ago" (mis à jour à chaque ingestion)
- 🗑️ **Revoke** : supprime la clé immédiatement

> Toast : *"Key revoked"*

### 8.4 Sécurité

- La clé complète n'est **jamais stockée** en base (seulement son hash SHA-256)
- Elle est **scopée par projet**, pas par utilisateur → un agent n'a pas besoin de vos credentials user
- Si une clé fuite : revokez-la et régénérez (les runs existants restent accessibles, seule l'ingestion future est bloquée)

---

## 9. Instrumenter un agent

La page **Integration** fournit 3 snippets copiables, avec votre clé pré-remplie.

### 9.1 Python (HTTP brut)

Le plus simple pour démarrer. Copiez l'onglet **Python** :

```python
import requests

AGENTTRACE_URL = "http://localhost:3000/api/events"  # votre URL de déploiement
API_KEY = "atr_votre_clé"                             # depuis la page Integration

headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

def emit(event: dict) -> dict:
    r = requests.post(AGENTTRACE_URL, json=event, headers=headers)
    r.raise_for_status()
    return r.json()

# 1. Démarrer un run (runId=None → le serveur en crée un)
run = emit({"runId": None, "name": "demo refund flow"})
run_id = run["runId"]

# 2. User → Orchestrator (handoff)
emit({"runId": run_id, "source": "User", "target": "Orchestrator",
      "type": "handoff", "label": "incoming message",
      "payload": {"message": "please refund order #4821"}, "durationMs": 90})

# 3. Orchestrator → LLM (llm_call)
emit({"runId": run_id, "source": "Orchestrator", "target": "LLM",
      "type": "llm_call", "label": "classify intent",
      "payload": {"result": "refund_request", "tokens": 184}, "durationMs": 480})

# 4. Orchestrator → tool (tool_call)
emit({"runId": run_id, "source": "Orchestrator", "target": "lookup_order",
      "type": "tool_call", "label": "lookup_order(#4821)",
      "payload": {"args": {"orderId": "4821"}}, "durationMs": 310})

# 5. tool → Orchestrator (tool_result)
emit({"runId": run_id, "source": "lookup_order", "target": "Orchestrator",
      "type": "tool_result", "label": "order found",
      "payload": {"orderId": "4821", "total": 89.99}, "durationMs": 5})

# 6. Orchestrator → User (final_answer)
emit({"runId": run_id, "source": "Orchestrator", "target": "User",
      "type": "final_answer", "label": "refund issued",
      "payload": {"answer": "Refund of $89.99 processed."}, "durationMs": 80})

# 7. Fermer le run
emit({"runId": run_id, "endRun": "completed"})
```

Ouvrez le run dans AgentTrace **avant** de lancer le script : vous verrez chaque flèche apparaître en direct.

### 9.2 TypeScript

Même logique avec `fetch`. Onglet **TypeScript** de la page Integration. Idéal si votre agent est en Node/Bun.

### 9.3 DeepAgents (LangChain)

C'est l'intégration la plus puissante. Le package publié
[`agenttrace-langchain`](https://pypi.org/project/agenttrace-langchain/)
fournit `AgentTraceMiddleware`, un `AgentMiddleware` (système de middleware
actuel de deepagents/LangChain — `before_agent` / `wrap_model_call` /
`wrap_tool_call` / `after_agent`), à attacher à votre agent.

#### Installation

```bash
pip install agenttrace-langchain deepagents langchain-openai
```

#### Utilisation

```python
from agenttrace_langchain import AgentTraceMiddleware
from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def web_search(query: str) -> str:
    """Search the web."""
    return "..."

@tool
def fetch_page(url: str) -> str:
    """Fetch a web page."""
    return "..."

agent = create_deep_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[web_search, fetch_page],
    system_prompt="You are a research assistant.",
    # 👇 UNE instance de middleware = UN run AgentTrace
    middleware=[AgentTraceMiddleware(run_name="research — Rust frameworks")],
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "State of Rust web frameworks?"}]}
)
```

Fonctionne aussi avec `await agent.ainvoke(...)` — les hooks async
(`awrap_model_call`/`awrap_tool_call`) se déclenchent automatiquement, sans
câblage supplémentaire.

#### Ce que le middleware capture automatiquement

| Hook `AgentMiddleware` | Événement AgentTrace | Flèche dans le diagramme |
|---|---|---|
| `wrap_model_call` | `llm_call` | Orchestrator → LLM (+ tokens, output preview) |
| `wrap_tool_call` (avant) | `tool_call` | Orchestrator → tool |
| `wrap_tool_call` (après) | `tool_result` | tool → Orchestrator (+ latence) |
| `wrap_tool_call` (exception) | `error` | tool → Orchestrator (rouge) |
| `wrap_tool_call` (tool = handoff/delegate) | `handoff` | Orchestrator → Sub-agent |
| `after_agent` | `final_answer` + ferme le run | Orchestrator → User |

Vous n'avez **rien à coder de plus** : tout agent `create_deep_agent`/
`create_agent` avec ce middleware est instrumenté automatiquement.

Émission non bloquante (thread + queue en arrière-plan) et jamais fatale
(une instance AgentTrace injoignable ou mal configurée désactive juste la
trace pour ce run, sans casser l'agent) — voir le
[README du package](https://github.com/CouLiBaLy-B/agenttrace/tree/main/integrations/agenttrace-langchain#reliability).

Pour un serveur qui **cache et réutilise un agent compilé** entre plusieurs
requêtes (le middleware est figé dans le graph au moment du build, donc mal
adapté à ce cas), utilisez plutôt `AsyncAgentTraceRun` — voir la section
["Servers with a cached/reused agent"](https://github.com/CouLiBaLy-B/agenttrace/tree/main/integrations/agenttrace-langchain#servers-with-a-cachedreused-agent-dont-use-the-middleware)
du même README.

#### Variables d'environnement

Le middleware lit (sauf si passé explicitement au constructeur) :
- `AGENTTRACE_URL` (défaut : `http://localhost:3000/api/events`)
- `AGENTTRACE_KEY` (obligatoire — clé projet, `atr_...`)

```bash
export AGENTTRACE_URL=https://votre-deploiement/api/events
export AGENTTRACE_KEY=atr_votre_clé
python votre_agent.py
```

---

## 10. Dashboard & stats

La vue **Dashboard** (premier item sidebar) donne une vue d'ensemble.

### 10.1 Les 5 cartes de stats

| Carte | Ce qu'elle montre |
|---|---|
| **Projects** | Nombre total de vos projets |
| **Total runs** | Tous runs confondus (running + completed + failed) |
| **Success rate** | % de `completed` parmi tous les runs |
| **Avg duration** | Durence moyenne des runs terminés |
| **Events captured** | Total d'événements tous runs confondus |

### 10.2 Signal mix

Barres horizontales montrant la **répartition par type d'événement** (llm_call, tool_call, tool_result, handoff, error, final_answer). Utile pour voir si un agent fait beaucoup d'erreurs ou trop d'appels LLM.

### 10.3 Recent activity

Les 8 derniers runs, cliquables → ouvrent la vue run directement. Affiche : statut (dot coloré), nom, projet, nb events, durée, timestamp relatif.

### 10.4 Grille projets

Une carte par projet avec runs count, success rate, dernière activité. Clic → vue détail projet.

### 10.5 État vide

Si vous supprimez tous vos projets : un radar avec *"No projects yet"* + bouton **"Create your first project"**.

---

## 11. Settings

### 11.1 Account

Affiche votre nom et email (en lecture seule). Bouton **"Sign out"** pour déconnexion.

### 11.2 Demo data

Bouton **"Reload demo projects"** : re-crée les 3 projets de démo (idempotent — vos projets existants ne sont pas touchés). Utile si vous avez tout supprimé et voulez revoir des exemples.

### 11.3 Preferences

- **Phosphor theme** : le thème oscilloscope sombre (recommandé, fixé à on)
- **Live event toasts** : notifications quand un run se termine (placeholder pour future feature)

### 11.4 About

Version, stack technique, signature *"trace · replay · debug"*.

---

## 12. Déploiement Docker

### 12.1 Build & run

```bash
# Depuis la racine du projet
docker compose up --build
```

Deux conteneurs démarrent :
- `web` sur le port 3000 (Next.js + Prisma)
- `socket` sur le port 3003 (Socket.IO)

La base SQLite est persistée dans un volume nommé `agenttrace-data`.

### 12.2 Configuration

Créez un `.env` (ou passez les vars au compose) :

```env
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://votre-domaine.com
DATABASE_URL=file:/app/data/agenttrace.db    # ou postgresql://...
SOCKET_SERVICE_URL=http://socket:3003
```

### 12.3 Production avec Postgres

1. Dans `prisma/schema.prisma`, changez `provider = "sqlite"` → `provider = "postgresql"`
2. `DATABASE_URL=postgresql://user:pass@host:5432/agenttrace`
3. `bun run db:push` (ou `db:migrate`) pour créer le schéma
4. Redémarrez le conteneur `web`

### 12.4 Reverse proxy

Mettez Caddy/Nginx devant les deux services. Le gateway doit router :
- `/?XTransformPort=3003` (WebSocket) → conteneur `socket:3003`
- tout le reste → conteneur `web:3000`

Le `Caddyfile` à la racine du projet montre la config de référence (utilisée en dev).

---

## 13. FAQ

### Q : J'ai créé un compte mais je ne vois aucun projet
**R** : Les projets démo sont censés se charger à l'inscription. Si ce n'est pas le cas, allez dans **Settings → Reload demo projects**. Si ça échoue, vérifiez la console (F12) pour une erreur réseau.

### Q : Mon agent émet des événements mais rien n'apparaît dans le diagramme
**R** : Vérifiez dans l'ordre :
1. La clé API est valide (page Integration → la clé doit apparaître dans la liste)
2. Le `runId` appartient bien au projet de cette clé (404 sinon)
3. Le service socket tourne (port 3003 — l'indicateur "ingestion online" dans la sidebar doit pulser)
4. Vous avez bien ouvert le **bon run** dans l'UI (le `runId` correspond)
5. Le `type` d'événement est valide (`llm_call | tool_call | tool_result | handoff | error | final_answer`)

### Q : Le badge indique "connecting…" au lieu de "listening"
**R** : Le navigateur n'arrive pas à joindre le service socket. Vérifiez que `socket:3003` est démarré et que le gateway route bien `?XTransformPort=3003`.

### Q : Puis-je suivre plusieurs runs en parallèle ?
**R** : Ouvrez plusieurs onglets, un par run. Chaque onglet s'abonne à son propre `runId` via le socket.

### Q : Les événements arrivent trop vite, le diagramme lag
**R** : Le diagramme est optimisé (SVG incrémental, pas de re-render complet). Si vous avez des centaines d'événements/sec, utilisez le replay pour les revisiter à vitesse réduite. En live, l'auto-scroll garde le dernier visible.

### Q : Comment supprimer un run sans supprimer le projet ?
**R** : Ouvrez le run → bouton poubelle (en haut à droite) → confirmation.

### Q : Ma clé API a fuité, que faire ?
**R** : Page Integration → bouton poubelle sur la clé concernée (la révoque immédiatement) → "Regenerate key" pour en créer une nouvelle. Mettez à jour votre agent avec la nouvelle clé. Les runs existants restent accessibles.

### Q : Puis-je partager un projet avec un collègue ?
**R** : Pas dans cette version. Les projets sont privés par utilisateur. (Roadmap : team/workspaces.)

### Q : Le replay ne marche pas
**R** : Le replay nécessite au moins 2 événements. Si le run n'en a qu'un, le bouton Replay est désactivé.

### Q : Comment basculer en thème clair ?
**R** : Le thème phosphore sombre est fixé (Settings → Preferences → "Phosphor theme" est grisé). Le produit est pensé dark-first (oscilloscope). Un thème clair existe dans le CSS mais n'est pas exposé dans l'UI.

### Q : Mes événements ont des payloads énormes, ça rame
**R** : Le panneau détail tronque l'affichage mais stocke tout. Côté agent, le callback DeepAgents tronque à 500 chars pour les `tool_result` et 240 pour les `llm_call` previews — adaptez ces limites dans votre copie du callback si besoin.

### Q : Puis-je exporter un run ?
**R** : Pas encore (roadmap : lien partageable read-only + export image du diagramme). En attendant, vous pouvez copier le payload d'un événement via le panneau détail.

---

## Référence rapide

| Je veux… | Je fais… |
|---|---|
| Démarrer | "Explore the live demo" sur l'écran d'accueil |
| Créer un projet | Projects → "New project" |
| Démarrer un run | Ouvrir un projet → "Start a run" |
| Voir le live | Ouvrir le run → le diagramme stream automatiquement |
| Rejouer | Vue run → "Replay" → Play |
| Inspecter un event | Cliquer la flèche |
| Récupérer ma clé | Integration → sélectionner le projet |
| Instrumenter mon agent | Integration → onglet Python/TS/DeepAgents → Copy |
| Voir les stats | Dashboard |
| Supprimer un run | Vue run → poubelle |
| Fermer un run | Vue run → "Close run" → completed/failed |
| Recharger la démo | Settings → "Reload demo projects" |
| Déployer | `docker compose up --build` |
