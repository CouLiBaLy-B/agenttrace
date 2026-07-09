// AgentTrace Socket.IO service
// Port 3003. Path "/" (required by Caddy gateway for browser clients).
//
// - Browser clients connect via io("/?XTransformPort=3003") and emit "subscribe" { runId }.
// - The Next.js API server connects as a server-side client (localhost:3003) and
//   emits "ingest:event" { event } / "ingest:run" { runId, patch }.
// - For replay, clients emit "replay" { runId, events, speed } and the server
//   schedules emitting them in order to that client only.

import { createServer } from "http"
import { Server } from "socket.io"

// Port is fixed at 3003 by default (the Caddy gateway routes
// ?XTransformPort=3003 here). Overridable via env for Docker/CI.
const PORT = Number(process.env.SOCKET_SERVICE_PORT) || 3003

const httpServer = createServer((_req, res) => {
  // socket.io handles "/" routes; any other path gets a simple 200 for liveness
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ service: "agenttrace-socket", ok: true }))
})

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/",
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Track replay timers so we can cancel them
const replayTimers = new Map<string, NodeJS.Timeout[]>()

io.on("connection", (socket) => {
  console.log(`[socket] connected ${socket.id}`)

  // Browser subscribes to a run's live events
  socket.on("subscribe", (payload: { runId: string }) => {
    if (!payload?.runId) return
    socket.join(`run:${payload.runId}`)
    socket.emit("subscribed", { runId: payload.runId })
  })

  socket.on("unsubscribe", (payload: { runId: string }) => {
    if (!payload?.runId) return
    socket.leave(`run:${payload.runId}`)
  })

  // Server-side ingest client forwards a new event → broadcast to run room
  socket.on("ingest:event", (event: any) => {
    if (event?.runId) {
      io.to(`run:${event.runId}`).emit("event", event)
    }
  })

  // Server-side ingest client forwards a run status update
  socket.on("ingest:run", (payload: { runId: string; patch: any }) => {
    if (payload?.runId) {
      io.to(`run:${payload.runId}`).emit("run:update", payload)
    }
  })

  // Replay mode: stream stored events back to this client at a given speed.
  socket.on("replay", (payload: { runId: string; events: any[]; speed: number }) => {
    if (!payload?.runId || !Array.isArray(payload.events)) return
    const { runId, events, speed } = payload

    const key = `${socket.id}:${runId}`
    const existing = replayTimers.get(key)
    if (existing) existing.forEach(clearTimeout)
    replayTimers.delete(key)

    if (!events.length) {
      socket.emit("replay:done", { runId })
      return
    }

    const timers: NodeJS.Timeout[] = []
    if (speed === 0) {
      events.forEach((e) => socket.emit("replay:event", e))
      socket.emit("replay:done", { runId })
      return
    }

    const baseTs = new Date(events[0].timestamp).getTime()
    const scale = 1 / speed
    for (const ev of events) {
      const offset = (new Date(ev.timestamp).getTime() - baseTs) * scale
      const t = setTimeout(() => {
        socket.emit("replay:event", ev)
      }, Math.min(offset, 60000))
      timers.push(t)
    }
    const lastOffset =
      (new Date(events[events.length - 1].timestamp).getTime() - baseTs) * scale
    const done = setTimeout(
      () => socket.emit("replay:done", { runId }),
      Math.min(lastOffset, 60000) + 50
    )
    timers.push(done)
    replayTimers.set(key, timers)
  })

  socket.on("replay:stop", (payload: { runId: string }) => {
    const key = `${socket.id}:${payload.runId}`
    const existing = replayTimers.get(key)
    if (existing) existing.forEach(clearTimeout)
    replayTimers.delete(key)
  })

  socket.on("disconnect", () => {
    for (const [key, timers] of replayTimers.entries()) {
      if (key.startsWith(`${socket.id}:`)) {
        timers.forEach(clearTimeout)
        replayTimers.delete(key)
      }
    }
    console.log(`[socket] disconnected ${socket.id}`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[AgentTrace] Socket.IO service listening on http://localhost:${PORT}`)
})
