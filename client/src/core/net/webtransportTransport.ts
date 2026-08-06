import type { Transport, TransportEvents } from './transport'

/**
 * WebTransport 传输占位。M0 阶段统一走 WebSocket；WebTransport/HTTP3
 * 通道接入与不可靠数据报（datagram）支持在后续里程碑实现（对应 NET-001 ~ NET-006）。
 *
 * 结构已就位：仅需实现 connect 中建立 session + datagram/bidi stream 的编解码封装。
 */
export class WebTransportTransport implements Transport {
  readonly kind = 'webtransport' as const

  connect(_url: string, _events: TransportEvents): Promise<void> {
    return Promise.reject(
      new Error('WebTransport 传输尚未实现（M0 使用 WebSocket）。请勿启用 WebTransport 偏好。'),
    )
  }

  send(_data: Uint8Array): void {
    // TODO(M1): datagram send
  }

  close(): void {
    // TODO(M1)
  }
}
