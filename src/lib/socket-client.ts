// Server-side helper: forwards events/run updates to the Socket.IO mini-service
// by connecting as a persistent socket.io client (server-to-server).
import { io, Socket } from "socket.io-client"

// In Docker, the socket service runs as a separate container reachable at
// http://socket:3003 (see docker-compose.yml). Locally it's localhost:3003.
const SOCKET_SERVICE_URL =
  process.env.SOCKET_SERVICE_URL || "http://localhost:3003"

export interface ForwardEvent {
  id: string
  runId: string
  timestamp: string
  seq: number
  source: string
  target: string
  type: string
  label?: string | null
  payload: any
  durationMs?: number | null
  status: string
}

let ingestSocket: Socket | null = null
let connecting: Promise<Socket> | null = null

function getIngestSocket(): Promise<Socket> {
  if (ingestSocket && ingestSocket.connected) return Promise.resolve(ingestSocket)
  if (connecting) return connecting

  connecting = new Promise((resolve) => {
    const sock = io(SOCKET_SERVICE_URL, {
      path: "/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      timeout: 3000,
    })
    sock.on("connect", () => {
      console.log("[ingest] connected to socket service")
    })
    sock.on("connect_error", (e) => {
      console.error("[ingest] connect error:", e.message)
    })
    ingestSocket = sock
    // resolve immediately so we don't block; events queue if not connected yet
    resolve(sock)
  })
  return connecting
}

// Kick off the connection lazily on first call
export async function emitRunEvent(event: ForwardEvent) {
  try {
    const sock = await getIngestSocket()
    sock.emit("ingest:event", event)
  } catch (e) {
    console.error("emitRunEvent failed:", e)
  }
}

export async function emitRunUpdate(runId: string, patch: any) {
  try {
    const sock = await getIngestSocket()
    sock.emit("ingest:run", { runId, patch })
  } catch (e) {
    console.error("emitRunUpdate failed:", e)
  }
}
