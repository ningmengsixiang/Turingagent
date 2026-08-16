export type WsEventHandler = (event: unknown) => void

export class WsClient {
  private socket: WebSocket | null = null
  private retry = 0
  private closed = false

  constructor(
    private readonly url: string,
    private readonly onEvent: WsEventHandler,
  ) {}

  connect(): void {
    this.closed = false
    this.open()
  }

  close(): void {
    this.closed = true
    this.socket?.close()
    this.socket = null
  }

  private open(): void {
    if (this.closed) return
    const token = localStorage.getItem('ta.token') ?? ''
    const socket = new WebSocket(`${this.url}?token=${encodeURIComponent(token)}`)
    this.socket = socket
    socket.onopen = () => {
      this.retry = 0
    }
    socket.onmessage = (e) => {
      try {
        this.onEvent(JSON.parse(String(e.data)))
      } catch {
        // 忽略无法解析的帧
      }
    }
    socket.onclose = () => {
      if (this.closed) return
      const delay = Math.min(1000 * 2 ** this.retry, 10_000)
      this.retry += 1
      setTimeout(() => this.open(), delay)
    }
    socket.onerror = () => socket.close()
  }
}
