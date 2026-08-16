import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
    this.onclose?.()
  }
}

import { WsClient } from './ws.js'

describe('WsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.instances = []
    localStorage.clear()
  })

  it('connects with the token and forwards parsed events', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    localStorage.setItem('ta.token', 'jwt-ws')
    const onEvent = vi.fn()
    const client = new WsClient('ws://localhost:3001/ws', onEvent)
    client.connect()
    expect(FakeWebSocket.instances[0]!.url).toBe('ws://localhost:3001/ws?token=jwt-ws')
    FakeWebSocket.instances[0]!.onmessage?.({ data: '{"type":"welcome","user":{"id":"u-a"}}' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'welcome', user: { id: 'u-a' } })
    client.close()
  })

  it('reconnects with backoff after close', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
    const client = new WsClient('ws://x', () => {})
    client.connect()
    FakeWebSocket.instances[0]!.onclose?.()
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1100)
    expect(FakeWebSocket.instances).toHaveLength(2)
    client.close()
    vi.useRealTimers()
  })
})
