import type { Transport, TransportEvents } from './transport'

/** WebSocket 传输（M0 默认）。二进制帧，ArrayBuffer 接收。 */
export class WebSocketTransport implements Transport {
  readonly kind = 'websocket' as const
  private ws: WebSocket | null = null

  connect(url: string, events: TransportEvents): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        settled = true
        resolve()
      }
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          events.onMessage(new Uint8Array(ev.data))
        }
      }
      ws.onclose = (ev) => {
        if (!settled) {
          settled = true
          reject(new Error(`连接失败: ${ev.reason || `code ${ev.code}`}`))
        }
        events.onClose(ev.code, ev.reason)
      }
      ws.onerror = () => {
        // onerror 后必然 onclose，错误信息在 onclose 中体现
      }
    })
  }

  send(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    }
  }

  close(): void {
    this.ws?.close()
  }
}
