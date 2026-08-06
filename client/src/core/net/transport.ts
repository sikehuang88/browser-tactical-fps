// 传输层抽象：WebSocket（M0）与 WebTransport（后续目标）共用同一接口。

export interface TransportEvents {
  onMessage(data: Uint8Array): void
  onClose(code: number, reason: string): void
}

export interface Transport {
  readonly kind: 'websocket' | 'webtransport'
  connect(url: string, events: TransportEvents): Promise<void>
  send(data: Uint8Array): void
  close(): void
}
