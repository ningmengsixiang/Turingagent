import type { WebSocket } from 'ws'

export interface RegistryEntry {
  socket: WebSocket
  userId: string
  sessionIds: Set<string>
}

export interface ConnectionRegistry {
  add(entry: RegistryEntry): void
  remove(socket: WebSocket): void
  broadcast(sessionId: string, payload: unknown): void
  socketsFor(sessionId: string): WebSocket[]
}

export function createRegistry(): ConnectionRegistry {
  const bySocket = new Map<WebSocket, RegistryEntry>()
  const bySession = new Map<string, Set<WebSocket>>()

  return {
    add(entry) {
      bySocket.set(entry.socket, entry)
      for (const sessionId of entry.sessionIds) {
        const set = bySession.get(sessionId) ?? new Set<WebSocket>()
        set.add(entry.socket)
        bySession.set(sessionId, set)
      }
    },
    remove(socket) {
      const entry = bySocket.get(socket)
      if (!entry) return
      bySocket.delete(socket)
      for (const sessionId of entry.sessionIds) {
        const set = bySession.get(sessionId)
        set?.delete(socket)
        if (set?.size === 0) bySession.delete(sessionId)
      }
    },
    broadcast(sessionId, payload) {
      const text = JSON.stringify(payload)
      for (const socket of this.socketsFor(sessionId)) {
        if (socket.readyState === 1) socket.send(text)
      }
    },
    socketsFor(sessionId) {
      return [...(bySession.get(sessionId) ?? [])]
    },
  }
}
